using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using ZcordUpdateManager.Models;
using ZcordUpdateManager.Services;

namespace ZcordUpdateManager;

public partial class MainWindow : Window
{
    private readonly UpdateService _service = new();
    private readonly ApiServer _api;
    private bool _publishing;
    private string _currentPage = "dashboard";

    public MainWindow()
    {
        InitializeComponent();
        _service.Init();
        _api = new ApiServer(_service);
        try
        {
            var port = _api.Start(8743);
            ApiStatus.Text = $"API : http://127.0.0.1:{port}";
        }
        catch (Exception ex)
        {
            ApiStatus.Text = $"API indisponible — {ex.Message}";
        }
        Loaded += async (_, _) =>
        {
            UpdateNavStyles();
            await RefreshUiAsync();
        };
    }

    protected override void OnClosed(EventArgs e)
    {
        _api.Dispose();
        base.OnClosed(e);
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        if (_publishing)
        {
            e.Cancel = true;
            MessageBox.Show(this, "Publication en cours — patiente quelques minutes.", "Zcord Update Manager",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        base.OnClosing(e);
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string page)
            ShowPage(page);
    }

    private void ShowPage(string page)
    {
        _currentPage = page;
        PageDashboard.Visibility = page == "dashboard" ? Visibility.Visible : Visibility.Collapsed;
        PageUpdates.Visibility = page == "updates" ? Visibility.Visible : Visibility.Collapsed;
        PageCreate.Visibility = page == "create" ? Visibility.Visible : Visibility.Collapsed;
        PageHistory.Visibility = page == "history" ? Visibility.Visible : Visibility.Collapsed;
        PageLogs.Visibility = page == "logs" ? Visibility.Visible : Visibility.Collapsed;
        PageSettings.Visibility = page == "settings" ? Visibility.Visible : Visibility.Collapsed;

        (PageTitle.Text, PageSub.Text) = page switch
        {
            "dashboard" => ("Gestionnaire de mises à jour", "Données GitHub + Zcord installé sur ce PC"),
            "updates" => ("Mises à jour", "Toutes les releases GitHub et brouillons"),
            "create" => ("Créer une MAJ", "Nouvelle version à publier"),
            "history" => ("Historique", "Publications et installations"),
            "logs" => ("Logs", "Journal d'activité"),
            "settings" => ("Paramètres", "Configuration GitHub"),
            _ => ("Zcord Update Manager", "")
        };
        UpdateNavStyles();
        _ = RefreshUiAsync();
    }

    private void UpdateNavStyles()
    {
        var navs = new[] { NavDashboard, NavUpdates, NavCreate, NavHistory, NavLogs, NavSettings };
        var tags = new[] { "dashboard", "updates", "create", "history", "logs", "settings" };
        for (var i = 0; i < navs.Length; i++)
            navs[i].Style = (Style)FindResource(tags[i] == _currentPage ? "NavBtnActive" : "NavBtn");
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshUiAsync();

    private async Task RefreshUiAsync()
    {
        StatusBar.Text = "Synchronisation GitHub...";
        try { await _service.SyncAllAsync(); }
        catch { /* logged in service */ }

        try
        {
            var stats = _service.GetStats();
            KpiPending.Text = stats.AvailableUpdates.ToString();
            KpiHealth.Text = $"{stats.SystemHealth}%";
            KpiPublished.Text = stats.Published ?? "Aucune";
            KpiInstalled.Text = stats.InstalledVersion ?? "Non détecté";
            KpiInstalledHint.Text = stats.LocalUpdateAvailable
                ? "MAJ disponible sur GitHub"
                : stats.InstalledVersion != null ? "À jour" : "%LocalAppData%\\Programs\\Zcord";
            KpiGithubCount.Text = $"{stats.GitHubReleaseCount} release(s) GitHub";
            KpiSuccessHint.Text = stats.SystemHealth >= 100
                ? "Bon état général"
                : stats.LocalUpdateAvailable
                    ? "MAJ locale en attente"
                    : stats.Counts.Pending > 0
                        ? $"{stats.Counts.Pending} brouillon(s) admin"
                        : "Vérification recommandée";

            var adminPending = _service.GetUpdates().Any(r => r.Status is "draft" or "scheduled");
            BtnPublishAll.IsEnabled = adminPending;

            var releases = _service.GetUpdates();
            var pending = releases.Where(r => r.Status is "draft" or "scheduled").ToList();
            var pubVer = releases.FirstOrDefault(r => r.Status == "published")?.Version ?? "—";
            var installed = _service.GetInstalledVersion();
            var localVer = installed != null ? $"v{installed}" : "—";

            var rows = new List<GridRow>();
            var localUpdate = _service.GetLocalPendingUpdate();
            if (localUpdate != null)
            {
                rows.Add(new GridRow
                {
                    Id = "local",
                    Name = "Zcord installé (PC)",
                    CurrentVer = localVer,
                    Version = localUpdate.Version,
                    SizeText = FormatSize(localUpdate.FileSize),
                    Priority = "Haute",
                    IsLocalClient = true
                });
            }

            rows.AddRange(pending.Select(r => new GridRow
            {
                Id = r.Id,
                Name = r.Name,
                CurrentVer = pubVer,
                Version = r.Version,
                SizeText = FormatSize(r.FileSize),
                Priority = r.Type switch { "major" => "Haute", "patch" => "Basse", _ => "Moyenne" }
            }));

            DashGrid.ItemsSource = rows;
            DashGrid.Visibility = rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            if (rows.Count == 0)
            {
                DashEmpty.Text = stats.InstalledVersion != null
                    ? $"Système à jour — Zcord {stats.InstalledVersion} = GitHub {stats.Published ?? "?"}\nCrée une nouvelle MAJ admin via « Créer une MAJ »"
                    : "Aucune MAJ en attente — crée une version admin via « Créer une MAJ »";
                DashEmpty.Visibility = Visibility.Visible;
            }
            else DashEmpty.Visibility = Visibility.Collapsed;

            AllGrid.ItemsSource = releases.Select(r => new GridRow
            {
                Id = r.Id,
                Name = r.Name,
                Version = r.Version,
                Status = r.Status,
                SizeText = FormatSize(r.FileSize),
                PublishedAt = r.PublishedAt ?? r.CreatedAt
            }).ToList();

            var ghHistory = releases
                .Where(r => r.Status is "published" or "archived")
                .Take(15)
                .Select(r => $"GitHub publish — {r.Version} [{r.Status}] — {r.PublishedAt ?? r.CreatedAt}");
            HistoryList.ItemsSource = ghHistory.Concat(
                _service.GetHistory().Select(h => $"{h.Action} — {h.Version} [{h.Result}] — {h.At}"));

            LogsList.ItemsSource = _service.GetLogs().Select(l => $"[{l.Level}] {l.Message} — {l.At}");

            var s = _service.GetSettings();
            SetOwner.Text = s.GithubOwner;
            SetRepo.Text = s.GithubRepo;

            var err = _service.LastSyncError;
            StatusBar.Text = err != null ? $"Sync partielle : {err}" : "Données GitHub à jour";
        }
        catch (Exception ex)
        {
            StatusBar.Text = $"Erreur : {ex.Message}";
        }
    }

    private async void PublishRow_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string id) return;
        if (id == "local")
        {
            var upd = _service.GetLocalPendingUpdate();
            if (upd?.SetupUrl is { Length: > 0 } url)
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
                MessageBox.Show(this, "Télécharge et lance Zcord-Setup.exe pour mettre à jour ton Zcord installé.", "MAJ locale",
                    MessageBoxButton.OK, MessageBoxImage.Information);
            }
            return;
        }
        await PublishAsync(id);
    }

    private async void PublishAll_Click(object sender, RoutedEventArgs e)
    {
        var pending = _service.GetUpdates().Where(r => r.Status is "draft" or "scheduled").ToList();
        if (pending.Count == 0)
        {
            MessageBox.Show(this, "Crée une MAJ admin d'abord (ex: v1.27.0) via « Créer une MAJ ».", "Aucun brouillon",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (MessageBox.Show(this, $"Publier {pending.Count} MAJ sur GitHub ?", "Confirmation",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        foreach (var r in pending)
        {
            if (!await PublishAsync(r.Id, silent: true)) break;
        }
        await RefreshUiAsync();
    }

    private async Task<bool> PublishAsync(string id, bool silent = false)
    {
        if (_publishing) return false;
        if (!silent && MessageBox.Show(this, "Build + upload GitHub ? (plusieurs minutes)", "Publier",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return false;

        _publishing = true;
        StatusBar.Text = "Publication en cours...";
        BtnPublishAll.IsEnabled = false;
        try
        {
            var progress = new Progress<string>(msg => StatusBar.Text = msg);
            await _service.PublishUpdateAsync(id, progress);
            StatusBar.Text = "Publié sur GitHub !";
            if (!silent)
                MessageBox.Show(this, "Publication réussie !", "OK", MessageBoxButton.OK, MessageBoxImage.Information);
            await RefreshUiAsync();
            return true;
        }
        catch (Exception ex)
        {
            StatusBar.Text = "Échec";
            MessageBox.Show(this, ex.Message, "Erreur publication", MessageBoxButton.OK, MessageBoxImage.Error);
            return false;
        }
        finally
        {
            _publishing = false;
            BtnPublishAll.IsEnabled = true;
        }
    }

    private void BrowseFile_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog
        {
            Filter = "Installateur|*.exe|Archive|*.zip|Tous|*.*",
            Title = "Choisir un fichier MAJ"
        };
        if (dlg.ShowDialog() == true) InFile.Text = dlg.FileName;
    }

    private async void SaveDraft_Click(object sender, RoutedEventArgs e) => await SaveReleaseAsync(false);
    private async void SavePublish_Click(object sender, RoutedEventArgs e) => await SaveReleaseAsync(true);

    private async Task SaveReleaseAsync(bool publish)
    {
        if (string.IsNullOrWhiteSpace(InVersion.Text))
        {
            MessageBox.Show(this, "Version requise", "Erreur", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (publish && MessageBox.Show(this, "Lancer build + publish GitHub ?", "Confirmation",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        try
        {
            CreateStatus.Text = "Enregistrement...";
            var rel = _service.CreateUpdate(new CreateReleaseRequest
            {
                Name = InName.Text,
                Version = InVersion.Text.Trim(),
                Notes = InNotes.Text,
                Type = "minor"
            });

            if (!string.IsNullOrWhiteSpace(InFile.Text) && File.Exists(InFile.Text))
                _service.UploadReleaseFile(rel.Id, InFile.Text);

            if (publish)
            {
                _publishing = true;
                await _service.PublishUpdateAsync(rel.Id, new Progress<string>(m => CreateStatus.Text = m));
                _publishing = false;
                CreateStatus.Text = "Publié !";
            }
            else
            {
                CreateStatus.Text = "Brouillon enregistré";
            }
            ShowPage("dashboard");
        }
        catch (Exception ex)
        {
            _publishing = false;
            CreateStatus.Text = ex.Message;
            MessageBox.Show(this, ex.Message, "Erreur", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        _service.SaveSettings(new AppSettings
        {
            GithubOwner = SetOwner.Text.Trim(),
            GithubRepo = SetRepo.Text.Trim(),
            AutoCheck = true,
            MaintenanceStart = "02:00",
            MaintenanceEnd = "05:00"
        });
        StatusBar.Text = "Paramètres sauvegardés";
        await RefreshUiAsync();
    }

    private static string FormatSize(long n)
    {
        if (n <= 0) return "—";
        var mb = n / (1024.0 * 1024.0);
        return mb >= 1 ? $"{mb:F1} MB" : $"{n / 1024} KB";
    }

    private sealed class GridRow
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string CurrentVer { get; set; } = "";
        public string Version { get; set; } = "";
        public string SizeText { get; set; } = "";
        public string Priority { get; set; } = "";
        public string Status { get; set; } = "";
        public string? PublishedAt { get; set; }
        public bool IsLocalClient { get; set; }
    }
}
