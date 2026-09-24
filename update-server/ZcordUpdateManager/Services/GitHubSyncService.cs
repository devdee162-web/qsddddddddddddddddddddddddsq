using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using ZcordUpdateManager.Models;

namespace ZcordUpdateManager.Services;

public sealed class GitHubSyncService
{
    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ZcordUpdateManager", "2.0"));
        c.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return c;
    }

    public async Task<GitHubSyncResult> SyncAsync(AppDatabase db, string owner, string repo, CancellationToken ct = default)
    {
        var url = $"https://api.github.com/repos/{owner}/{repo}/releases?per_page=30";
        var json = await Http.GetStringAsync(url, ct).ConfigureAwait(false);
        var releases = JsonNode.Parse(json)?.AsArray() ?? [];

        var synced = 0;
        string? latestTag = null;
        DateTime? latestDate = null;

        foreach (var node in releases)
        {
            if (node == null) continue;
            var tag = node["tag_name"]?.GetValue<string>() ?? "";
            if (string.IsNullOrEmpty(tag)) continue;

            var isDraft = node["draft"]?.GetValue<bool>() ?? false;
            var isPrerelease = node["prerelease"]?.GetValue<bool>() ?? false;
            if (isDraft) continue;

            var setup = FindAsset(node["assets"]?.AsArray(), "Zcord-Setup.exe")
                        ?? FindAsset(node["assets"]?.AsArray(), "Zcord-Installer.exe");
            var manifest = FindAsset(node["assets"]?.AsArray(), "files-manifest.json");
            var publishedAt = node["published_at"]?.GetValue<string>() ?? DateTime.UtcNow.ToString("o");
            var pubDate = DateTime.TryParse(publishedAt, out var dt) ? dt : DateTime.UtcNow;

            if (!isPrerelease && (latestDate == null || pubDate > latestDate))
            {
                latestDate = pubDate;
                latestTag = tag;
            }

            var rel = db.Releases.FirstOrDefault(r => r.Version.Equals(tag, StringComparison.OrdinalIgnoreCase));
            if (rel == null)
            {
                rel = new ReleaseItem
                {
                    Id = Guid.NewGuid().ToString(),
                    Version = tag.StartsWith('v') ? tag : $"v{tag}",
                    Name = node["name"]?.GetValue<string>() ?? $"Zcord {tag}",
                    CreatedAt = publishedAt
                };
                db.Releases.Add(rel);
            }

            rel.Name = node["name"]?.GetValue<string>() ?? rel.Name;
            rel.Notes = node["body"]?.GetValue<string>() ?? rel.Notes;
            rel.SetupUrl = setup?.DownloadUrl ?? rel.SetupUrl;
            rel.ManifestUrl = manifest?.DownloadUrl ?? rel.ManifestUrl;
            rel.FileSize = setup?.Size ?? rel.FileSize;
            rel.PublishedAt = publishedAt;
            rel.Type = GuessType(tag);
            synced++;

            if (tag.Equals(latestTag, StringComparison.OrdinalIgnoreCase))
                rel.Status = "published";
            else
                rel.Status = "archived";
        }

        db.Releases = db.Releases
            .OrderByDescending(r => ParseDate(r.PublishedAt ?? r.CreatedAt))
            .ToList();

        return new GitHubSyncResult
        {
            SyncedCount = synced,
            LatestVersion = latestTag,
            SyncedAt = DateTime.UtcNow
        };
    }

    public static string? GetInstalledZcordVersion()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new[]
        {
            Path.Combine(local, "Programs", "Zcord", "resources", "app", "package.json"),
            Path.Combine(local, "Programs", "Zcord", "Data", "zcord-version.json"),
            Path.Combine(local, "Programs", "Zcord", "VERSION")
        };

        foreach (var p in candidates)
        {
            if (!File.Exists(p)) continue;
            try
            {
                var text = File.ReadAllText(p).Trim();
                if (p.EndsWith(".json"))
                {
                    var node = JsonNode.Parse(text);
                    var v = node?["version"]?.GetValue<string>();
                    if (!string.IsNullOrWhiteSpace(v)) return NormalizeVer(v);
                }
                else if (!string.IsNullOrWhiteSpace(text))
                {
                    return NormalizeVer(text);
                }
            }
            catch { /* next */ }
        }
        return null;
    }

    public static string? GetProjectVersion(string root)
    {
        try
        {
            var pkg = Path.Combine(root, "package.json");
            if (!File.Exists(pkg)) return null;
            return NormalizeVer(JsonNode.Parse(File.ReadAllText(pkg))?["version"]?.GetValue<string>());
        }
        catch { return null; }
    }

    private static GitHubAsset? FindAsset(JsonArray? assets, string name)
    {
        if (assets == null) return null;
        foreach (var a in assets)
        {
            if (a?["name"]?.GetValue<string>()?.Equals(name, StringComparison.OrdinalIgnoreCase) == true)
            {
                return new GitHubAsset
                {
                    DownloadUrl = a["browser_download_url"]?.GetValue<string>() ?? "",
                    Size = a["size"]?.GetValue<long>() ?? 0
                };
            }
        }
        return null;
    }

    private static string GuessType(string tag)
    {
        var parts = tag.TrimStart('v', 'V').Split('.');
        if (parts.Length >= 3 && parts[2] != "0") return "patch";
        if (parts.Length >= 2 && parts[1] != "0") return "minor";
        return "major";
    }

    private static DateTime ParseDate(string? iso) =>
        DateTime.TryParse(iso, out var d) ? d : DateTime.MinValue;

    private static string NormalizeVer(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return "";
        v = v.Trim().TrimStart('v', 'V');
        return v;
    }

    private sealed class GitHubAsset
    {
        public string DownloadUrl { get; set; } = "";
        public long Size { get; set; }
    }
}

public sealed class GitHubSyncResult
{
    public int SyncedCount { get; set; }
    public string? LatestVersion { get; set; }
    public DateTime SyncedAt { get; set; }
}
