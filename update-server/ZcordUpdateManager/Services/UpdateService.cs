using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using ZcordUpdateManager.Models;

namespace ZcordUpdateManager.Services;

public sealed class UpdateService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly string _root;
    private readonly string _dataDir;
    private readonly string _dataFile;
    private readonly string _uploadsDir;
    private readonly string _releaseDir;
    private readonly GitHubSyncService _github = new();
    private readonly object _lock = new();
    private DateTime _lastSync = DateTime.MinValue;
    private string? _lastSyncError;

    public UpdateService()
    {
        _root = FindZcordRoot();
        _dataDir = Path.Combine(_root, "update-server", "data");
        _dataFile = Path.Combine(_dataDir, "db.json");
        _uploadsDir = Path.Combine(_dataDir, "uploads");
        _releaseDir = Path.Combine(_root, "release");
        Directory.CreateDirectory(_dataDir);
        Directory.CreateDirectory(_uploadsDir);
    }

    public string Root => _root;
    public string ReleaseDir => _releaseDir;

    private static string FindZcordRoot()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 12; i++)
        {
            if (File.Exists(Path.Combine(dir, "package.json")))
                return dir;
            if (Directory.Exists(Path.Combine(dir, "update-server", "data")))
                return dir;
            var parent = Directory.GetParent(dir);
            if (parent == null) break;
            dir = parent.FullName;
        }
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
    }

    public void Init()
    {
        SyncAllAsync().GetAwaiter().GetResult();
    }

    public async Task SyncAllAsync(CancellationToken ct = default)
    {
        AppDatabase db;
        lock (_lock)
        {
            db = LoadDb();
            LoadGithubDefaults(db);
            SyncFromReleaseFolder(db);
            SaveDb(db);
        }

        try
        {
            var result = await _github.SyncAsync(db, db.Settings.GithubOwner, db.Settings.GithubRepo, ct).ConfigureAwait(false);
            lock (_lock)
            {
                AddLog(db, "info", $"Sync GitHub OK — {result.SyncedCount} release(s), latest {result.LatestVersion}");
                SaveDb(db);
                _lastSync = result.SyncedAt;
                _lastSyncError = null;
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                AddLog(db, "warn", $"Sync GitHub echoue: {ex.Message}");
                SaveDb(db);
                _lastSyncError = ex.Message;
            }
        }
    }

    private void LoadGithubDefaults(AppDatabase db)
    {
        try
        {
            var gh = Path.Combine(_root, "GITHUB.json");
            if (!File.Exists(gh)) return;
            var node = JsonNode.Parse(File.ReadAllText(gh))!.AsObject();
            if (node["owner"] != null) db.Settings.GithubOwner = node["owner"]!.GetValue<string>()!;
            if (node["repo"] != null) db.Settings.GithubRepo = node["repo"]!.GetValue<string>()!;
        }
        catch { /* ignore */ }
    }

    public ReleaseItem? GetLocalPendingUpdate()
    {
        lock (_lock)
        {
            var installed = GitHubSyncService.GetInstalledZcordVersion();
            var published = GetPublished(LoadDb());
            if (string.IsNullOrEmpty(installed) || published == null) return null;
            var remote = published.Version.TrimStart('v', 'V');
            return CompareVersion(installed, remote) < 0 ? published : null;
        }
    }

    public string? GetInstalledVersion() => GitHubSyncService.GetInstalledZcordVersion();
    public string? LastSyncError => _lastSyncError;

    public StatsDto GetStats()
    {
        lock (_lock)
        {
            var db = LoadDb();
            SyncFromReleaseFolder(db);
            SaveDb(db);

            var published = GetPublished(db);
            var pending = db.Releases.Where(r => r.Status is "draft" or "scheduled").ToList();
            var success = db.History.Count(h => h.Result == "success");
            var failed = db.History.Count(h => h.Result == "failed");
            var pendingCount = pending.Count;

            var installed = GitHubSyncService.GetInstalledZcordVersion();
            var project = GitHubSyncService.GetProjectVersion(_root);
            var publishedVer = published?.Version.TrimStart('v', 'V') ?? "";
            var localUpdate = !string.IsNullOrEmpty(installed) && !string.IsNullOrEmpty(publishedVer)
                && CompareVersion(installed, publishedVer) < 0;

            var health = 60;
            if (published != null)
            {
                if (pendingCount > 0) health = 75;
                else if (localUpdate) health = 85;
                else health = 100;
            }

            var lastCheck = _lastSync != DateTime.MinValue
                ? _lastSync.ToString("o")
                : db.Logs.FirstOrDefault(l => l.Message.Contains("check", StringComparison.OrdinalIgnoreCase))?.At
                  ?? DateTime.UtcNow.ToString("o");

            return new StatsDto
            {
                AvailableUpdates = pendingCount + (localUpdate ? 1 : 0),
                SystemHealth = health,
                LastCheck = lastCheck,
                FreedSpaceGb = 0,
                Published = published?.Version,
                InstalledVersion = installed != null ? $"v{installed}" : null,
                ProjectVersion = project != null ? $"v{project}" : null,
                LocalUpdateAvailable = localUpdate,
                GitHubReleaseCount = db.Releases.Count(r => r.Status is "published" or "archived"),
                Counts = new CountsDto
                {
                    Success = success,
                    Failed = failed,
                    Pending = pendingCount,
                    Installed = success > 0 ? success : published != null && !localUpdate ? 1 : 0
                }
            };
        }
    }

    public List<ReleaseItem> GetUpdates()
    {
        lock (_lock)
        {
            var db = LoadDb();
            SyncFromReleaseFolder(db);
            SaveDb(db);
            return db.Releases;
        }
    }

    public ReleaseItem CreateUpdate(CreateReleaseRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Version))
            throw new InvalidOperationException("version requise");

        lock (_lock)
        {
            var db = LoadDb();
            var tag = req.Version.StartsWith('v') ? req.Version : $"v{req.Version}";
            var rel = new ReleaseItem
            {
                Id = Guid.NewGuid().ToString(),
                Name = string.IsNullOrWhiteSpace(req.Name) ? $"Zcord {tag}" : req.Name,
                Version = tag,
                Type = req.Type ?? "minor",
                Status = "draft",
                Notes = req.Notes ?? "",
                AutoCheck = req.AutoCheck,
                AutoBackup = req.AutoBackup,
                CreatedAt = DateTime.UtcNow.ToString("o")
            };
            db.Releases.Insert(0, rel);
            AddLog(db, "info", $"Brouillon cree: {tag}");
            SaveDb(db);
            return rel;
        }
    }

    public ReleaseItem UploadReleaseFile(string id, string sourcePath)
    {
        if (!File.Exists(sourcePath))
            throw new FileNotFoundException("fichier introuvable");

        lock (_lock)
        {
            var db = LoadDb();
            var rel = db.Releases.FirstOrDefault(r => r.Id == id)
                ?? throw new InvalidOperationException("introuvable");

            var ext = sourcePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? ".exe" : ".zip";
            var dest = Path.Combine(_uploadsDir, rel.Id + ext);
            File.Copy(sourcePath, dest, true);
            rel.PackagePath = dest;
            rel.FileSize = new FileInfo(dest).Length;
            rel.Sha256 = Sha256File(dest);
            AddLog(db, "info", $"Fichier upload pour {rel.Version}");
            SaveDb(db);
            return rel;
        }
    }

    public async Task<object> PublishUpdateAsync(string id, IProgress<string>? progress = null)
    {
        ReleaseItem rel;
        lock (_lock)
        {
            var db = LoadDb();
            rel = db.Releases.FirstOrDefault(r => r.Id == id)
                ?? throw new InvalidOperationException("introuvable");
        }

        try
        {
            progress?.Report($"Publication {rel.Version}...");
            await PublishCoreAsync(rel, progress).ConfigureAwait(false);

            lock (_lock)
            {
                var db = LoadDb();
                rel = db.Releases.First(r => r.Id == id);
                SyncFromReleaseFolder(db);
                foreach (var r in db.Releases.Where(r => r.Id != id && r.Status == "published"))
                    r.Status = "archived";
                rel.Status = "published";
                rel.PublishedAt = DateTime.UtcNow.ToString("o");
                db.History.Insert(0, new HistoryItem
                {
                    Id = Guid.NewGuid().ToString(),
                    Version = rel.Version,
                    Action = "publish",
                    Result = "success",
                    At = DateTime.UtcNow.ToString("o")
                });
                AddLog(db, "success", $"Publie sur GitHub: {rel.Version}");
                SaveDb(db);
                return new { ok = true, release = rel };
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                var db = LoadDb();
                AddLog(db, "error", $"Echec publish: {ex.Message}");
                db.History.Insert(0, new HistoryItem
                {
                    Id = Guid.NewGuid().ToString(),
                    Version = rel.Version,
                    Action = "publish",
                    Result = "failed",
                    Detail = ex.Message,
                    At = DateTime.UtcNow.ToString("o")
                });
                SaveDb(db);
            }
            throw;
        }
    }

    private async Task PublishCoreAsync(ReleaseItem rel, IProgress<string>? progress)
    {
        var pkgPath = Path.Combine(_root, "package.json");
        var pkgNode = JsonNode.Parse(await File.ReadAllTextAsync(pkgPath).ConfigureAwait(false))!.AsObject();
        pkgNode["version"] = rel.Version.TrimStart('v', 'V');
        await File.WriteAllTextAsync(pkgPath, pkgNode.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n").ConfigureAwait(false);

        var setupOut = Path.Combine(_releaseDir, "Zcord-Setup.exe");
        var hasUpload = !string.IsNullOrEmpty(rel.PackagePath) && File.Exists(rel.PackagePath);

        if (hasUpload)
        {
            progress?.Report("Copie du Setup uploadé...");
            Directory.CreateDirectory(_releaseDir);
            File.Copy(rel.PackagePath!, setupOut, true);
            await RunShellAsync("node scripts/publish-release.cjs --upload", _root, progress).ConfigureAwait(false);
        }
        else if (File.Exists(setupOut) && new FileInfo(setupOut).Length > 20 * 1024 * 1024)
        {
            progress?.Report("Upload GitHub (Setup existant)...");
            await RunShellAsync("node scripts/publish-release.cjs --upload", _root, progress).ConfigureAwait(false);
        }
        else
        {
            var pnpm = ResolvePnpm();
            if (pnpm == null)
                throw new InvalidOperationException("pnpm introuvable — installe-le ou uploade un Zcord-Setup.exe");
            progress?.Report("Build en cours (plusieurs minutes)...");
            await RunShellAsync($"\"{pnpm}\" run buildInstaller:full", _root, progress).ConfigureAwait(false);
            progress?.Report("Upload GitHub...");
            await RunShellAsync("node scripts/publish-release.cjs --upload", _root, progress).ConfigureAwait(false);
        }
    }

    public ReleaseItem UnpublishUpdate(string id)
    {
        lock (_lock)
        {
            var db = LoadDb();
            var rel = db.Releases.FirstOrDefault(r => r.Id == id)
                ?? throw new InvalidOperationException("introuvable");
            rel.Status = "draft";
            AddLog(db, "warn", $"Depublie: {rel.Version}");
            SaveDb(db);
            return rel;
        }
    }

    public CheckResponse CheckUpdate(string? localVersion)
    {
        lock (_lock)
        {
            var db = LoadDb();
            SyncFromReleaseFolder(db);
            SaveDb(db);
            var local = (localVersion ?? "0.0.0").TrimStart('v', 'V');
            var published = GetPublished(db);
            AddLog(db, "info", $"Check client v{local}");

            if (published == null)
                return new CheckResponse { Available = false, Version = local };

            var remote = published.Version.TrimStart('v', 'V');
            var newer = CompareVersion(local, remote) < 0;
            var setupPath = Path.Combine(_releaseDir, "Zcord-Setup.exe");
            var setupUrl = !string.IsNullOrEmpty(published.SetupUrl)
                ? published.SetupUrl
                : $"https://github.com/{db.Settings.GithubOwner}/{db.Settings.GithubRepo}/releases/latest/download/Zcord-Setup.exe";

            return new CheckResponse
            {
                Available = newer || published.Force,
                Force = published.Force,
                Version = published.Version,
                Name = published.Name,
                Type = published.Type,
                SetupUrl = setupUrl,
                ManifestUrl = published.ManifestUrl,
                Notes = published.Notes,
                Sha256 = !string.IsNullOrEmpty(published.Sha256) ? published.Sha256 : File.Exists(setupPath) ? Sha256File(setupPath) : "",
                FileSize = published.FileSize > 0 ? published.FileSize : File.Exists(setupPath) ? new FileInfo(setupPath).Length : 0
            };
        }
    }

    public object ReportClient(JsonNode body)
    {
        lock (_lock)
        {
            var db = LoadDb();
            var report = new ClientReport
            {
                Id = Guid.NewGuid().ToString(),
                Version = body["version"]?.GetValue<string>(),
                Status = body["status"]?.GetValue<string>(),
                Detail = body["detail"]?.GetValue<string>(),
                At = DateTime.UtcNow.ToString("o")
            };
            db.Reports.Insert(0, report);
            if (db.Reports.Count > 200) db.Reports = db.Reports.Take(200).ToList();
            if (report.Status == "success")
            {
                db.History.Insert(0, new HistoryItem
                {
                    Id = Guid.NewGuid().ToString(),
                    Version = report.Version ?? "",
                    Action = "client_install",
                    Result = "success",
                    At = report.At
                });
            }
            AddLog(db, "info", $"Client report: {report.Status} {report.Version}");
            SaveDb(db);
            return new { ok = true };
        }
    }

    public List<HistoryItem> GetHistory()
    {
        lock (_lock) return LoadDb().History;
    }

    public List<LogItem> GetLogs()
    {
        lock (_lock) return LoadDb().Logs.Take(100).ToList();
    }

    public AppSettings GetSettings()
    {
        lock (_lock) return LoadDb().Settings;
    }

    public AppSettings SaveSettings(AppSettings settings)
    {
        lock (_lock)
        {
            var db = LoadDb();
            db.Settings = settings;
            SaveDb(db);
            return db.Settings;
        }
    }

    private AppDatabase LoadDb()
    {
        if (!File.Exists(_dataFile))
            return new AppDatabase();

        var json = File.ReadAllText(_dataFile);
        return JsonSerializer.Deserialize<AppDatabase>(json, JsonOpts) ?? new AppDatabase();
    }

    private void SaveDb(AppDatabase db)
    {
        if (db.Logs.Count > 500) db.Logs = db.Logs.Take(500).ToList();
        File.WriteAllText(_dataFile, JsonSerializer.Serialize(db, JsonOpts));
    }

    private static ReleaseItem? GetPublished(AppDatabase db) =>
        db.Releases.FirstOrDefault(r => r.Status == "published");

    private void SyncFromReleaseFolder(AppDatabase db)
    {
        var updateJson = Path.Combine(_releaseDir, "update.json");
        var setup = Path.Combine(_releaseDir, "Zcord-Setup.exe");
        if (!File.Exists(updateJson) || !File.Exists(setup)) return;

        var update = JsonNode.Parse(File.ReadAllText(updateJson))!.AsObject();
        var ver = (update["version"]?.GetValue<string>() ?? "").TrimStart('v', 'V');
        var pkgPath = Path.Combine(_root, "package.json");
        if (File.Exists(pkgPath))
        {
            var pkgVer = JsonNode.Parse(File.ReadAllText(pkgPath))?["version"]?.GetValue<string>();
            if (!string.IsNullOrEmpty(pkgVer)) ver = pkgVer;
        }
        var tag = ver.StartsWith('v') ? ver : $"v{ver}";

        var rel = db.Releases.FirstOrDefault(r => r.Version == tag);
        if (rel == null)
        {
            rel = new ReleaseItem
            {
                Id = Guid.NewGuid().ToString(),
                Name = $"Zcord {tag}",
                Version = tag,
                Type = "minor",
                Status = "published",
                SetupUrl = update["setupUrl"]?.GetValue<string>() ?? "",
                ManifestUrl = update["manifestUrl"]?.GetValue<string>() ?? "",
                FileSize = new FileInfo(setup).Length,
                Sha256 = Sha256File(setup),
                CreatedAt = DateTime.UtcNow.ToString("o"),
                PublishedAt = DateTime.UtcNow.ToString("o")
            };
            db.Releases.Insert(0, rel);
            AddLog(db, "info", $"Sync release {tag} depuis release/");
        }
        else
        {
            rel.SetupUrl = update["setupUrl"]?.GetValue<string>() ?? rel.SetupUrl;
            rel.ManifestUrl = update["manifestUrl"]?.GetValue<string>() ?? rel.ManifestUrl;
            rel.FileSize = new FileInfo(setup).Length;
            rel.Sha256 = Sha256File(setup);
            rel.Status = "published";
            rel.PublishedAt = DateTime.UtcNow.ToString("o");
        }
    }

    private static void AddLog(AppDatabase db, string level, string message)
    {
        db.Logs.Insert(0, new LogItem
        {
            Id = Guid.NewGuid().ToString(),
            Level = level,
            Message = message,
            At = DateTime.UtcNow.ToString("o")
        });
    }

    private static string Sha256File(string path)
    {
        using var sha = SHA256.Create();
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
    }

    private static int CompareVersion(string a, string b)
    {
        var av = a.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        var bv = b.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        for (var i = 0; i < 3; i++)
        {
            var ai = i < av.Length ? av[i] : 0;
            var bi = i < bv.Length ? bv[i] : 0;
            if (ai != bi) return ai.CompareTo(bi);
        }
        return 0;
    }

    private static string? ResolvePnpm()
    {
        var tries = new[]
        {
            "pnpm",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "pnpm.cmd"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "pnpm", "pnpm.exe"),
            "npx pnpm"
        };
        foreach (var cmd in tries)
        {
            try
            {
                using var p = Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c \"{cmd}\" --version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                p?.WaitForExit(15000);
                if (p?.ExitCode == 0) return cmd;
            }
            catch { /* next */ }
        }
        return null;
    }

    private static async Task RunShellAsync(string command, string cwd, IProgress<string>? progress)
    {
        var tcs = new TaskCompletionSource<int>();
        var psi = new ProcessStartInfo("cmd.exe", $"/c {command}")
        {
            WorkingDirectory = cwd,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) progress?.Report(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) progress?.Report(e.Data); };
        proc.Exited += (_, _) => tcs.TrySetResult(proc.ExitCode);
        if (!proc.Start()) throw new InvalidOperationException("Impossible de lancer la commande");
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        var code = await tcs.Task.ConfigureAwait(false);
        if (code != 0) throw new InvalidOperationException($"Commande echouee (code {code})");
    }
}
