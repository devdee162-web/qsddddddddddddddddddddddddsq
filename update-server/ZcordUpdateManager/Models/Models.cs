using System.Text.Json.Serialization;

namespace ZcordUpdateManager.Models;

public sealed class AppDatabase
{
    public AppSettings Settings { get; set; } = new();
    public List<ReleaseItem> Releases { get; set; } = [];
    public List<HistoryItem> History { get; set; } = [];
    public List<LogItem> Logs { get; set; } = [];
    public List<ClientReport> Reports { get; set; } = [];
}

public sealed class AppSettings
{
    public bool AutoCheck { get; set; } = true;
    public int CheckIntervalHours { get; set; } = 6;
    public string MaintenanceStart { get; set; } = "02:00";
    public string MaintenanceEnd { get; set; } = "05:00";
    public string GithubOwner { get; set; } = "devdee162-web";
    public string GithubRepo { get; set; } = "qsddddddddddddddddddddddddsq";
}

public sealed class ReleaseItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Type { get; set; } = "minor";
    public string Status { get; set; } = "draft";
    public string Notes { get; set; } = "";
    public bool AutoCheck { get; set; }
    public bool AutoBackup { get; set; } = true;
    public string SetupUrl { get; set; } = "";
    public string ManifestUrl { get; set; } = "";
    public long FileSize { get; set; }
    public string Sha256 { get; set; } = "";
    public string? PackagePath { get; set; }
    public string CreatedAt { get; set; } = "";
    public string? PublishedAt { get; set; }
    public bool Force { get; set; }
}

public sealed class HistoryItem
{
    public string Id { get; set; } = "";
    public string Version { get; set; } = "";
    public string Action { get; set; } = "";
    public string Result { get; set; } = "";
    public string? Detail { get; set; }
    public string At { get; set; } = "";
}

public sealed class LogItem
{
    public string Id { get; set; } = "";
    public string Level { get; set; } = "";
    public string Message { get; set; } = "";
    public string At { get; set; } = "";
}

public sealed class ClientReport
{
    public string Id { get; set; } = "";
    public string? Version { get; set; }
    public string? Status { get; set; }
    public string? Detail { get; set; }
    public string At { get; set; } = "";
}

public sealed class StatsDto
{
    public int AvailableUpdates { get; set; }
    public int SystemHealth { get; set; }
    public string LastCheck { get; set; } = "";
    public double FreedSpaceGb { get; set; }
    public string? Published { get; set; }
    public string? InstalledVersion { get; set; }
    public string? ProjectVersion { get; set; }
    public bool LocalUpdateAvailable { get; set; }
    public int GitHubReleaseCount { get; set; }
    public CountsDto Counts { get; set; } = new();
}

public sealed class CountsDto
{
    public int Success { get; set; }
    public int Failed { get; set; }
    public int Pending { get; set; }
    public int Installed { get; set; }
}

public sealed class CheckResponse
{
    public bool Available { get; set; }
    public bool Force { get; set; }
    public string Version { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string SetupUrl { get; set; } = "";
    public string ManifestUrl { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public long FileSize { get; set; }
}

public sealed class CreateReleaseRequest
{
    public string? Name { get; set; }
    public string Version { get; set; } = "";
    public string? Type { get; set; }
    public string? Notes { get; set; }
    public bool AutoCheck { get; set; }
    public bool AutoBackup { get; set; } = true;
}
