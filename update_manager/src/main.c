#include "updater.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#define mkdir_p(path) _mkdir(path)
#else
#include <sys/stat.h>
#define mkdir_p(path) mkdir(path, 0755)
#endif

static void default_config(UpdaterConfig *cfg) {
    memset(cfg, 0, sizeof(*cfg));
    strcpy(cfg->server_url, "http://127.0.0.1:3847");
    strcpy(cfg->current_version, "1.0.0");
    strcpy(cfg->backup_dir, "backups");
    strcpy(cfg->log_file, "logs/updater.log");
    cfg->auto_backup = 1;

#ifdef _WIN32
    char *local = getenv("LOCALAPPDATA");
    if (local) snprintf(cfg->install_dir, sizeof(cfg->install_dir), "%s\\Programs\\Zcord", local);
#endif
}

static int ensure_dirs(const UpdaterConfig *cfg) {
    mkdir_p("logs");
    mkdir_p(cfg->backup_dir);
    return 0;
}

static void print_usage(void) {
    printf("Zcord Update Manager (C)\n");
    printf("  zcord-updater check [--config path]\n");
    printf("  zcord-updater install [--config path]\n");
    printf("  zcord-updater run [--config path]   (check + install si dispo)\n");
}

int main(int argc, char **argv) {
    const char *cmd = argc > 1 ? argv[1] : "run";
    const char *config_path = "config/update.json";

    for (int i = 2; i < argc - 1; i++) {
        if (strcmp(argv[i], "--config") == 0) config_path = argv[i + 1];
    }

    UpdaterConfig cfg;
    default_config(&cfg);
    if (config_load(&cfg, config_path) != 0) {
        fprintf(stderr, "Config introuvable: %s (defaults)\n", config_path);
    }

    char ver_file[512];
    snprintf(ver_file, sizeof(ver_file), "%s/version.txt", cfg.install_dir[0] ? cfg.install_dir : ".");
    char disk_ver[ZCORD_MAX_VER];
    if (version_read(ver_file, disk_ver, sizeof(disk_ver)) == 0 && disk_ver[0]) {
        strncpy(cfg.current_version, disk_ver, sizeof(cfg.current_version) - 1);
    }

    ensure_dirs(&cfg);

    if (strcmp(cmd, "help") == 0 || strcmp(cmd, "-h") == 0) {
        print_usage();
        return 0;
    }

    UpdateInfo info;
    int do_install = strcmp(cmd, "install") == 0 || strcmp(cmd, "run") == 0;

    log_msg(&cfg, "INFO", "Version locale: %s", cfg.current_version);
    log_msg(&cfg, "INFO", "Serveur: %s", cfg.server_url);

    int avail = check_for_updates(&cfg, &info);
    if (avail < 0) {
        log_msg(&cfg, "ERROR", "Echec verification MAJ");
        report_status(&cfg, cfg.current_version, "error", "check failed");
        return 1;
    }

    if (!info.available) {
        log_msg(&cfg, "INFO", "Deja a jour");
        report_status(&cfg, cfg.current_version, "uptodate", "no update");
        if (strcmp(cmd, "check") == 0) return 0;
        if (!do_install) return 0;
        return 0;
    }

    log_msg(&cfg, "INFO", "MAJ disponible: %s (%s)", info.version, info.name);
    printf("Update: %s -> %s\n", cfg.current_version, info.version);
    if (info.notes[0]) printf("Notes: %s\n", info.notes);

    if (strcmp(cmd, "check") == 0) return 0;
    if (!do_install) return 0;

    char dest[ZCORD_MAX_PATH];
    snprintf(dest, sizeof(dest), "%s/zcord-update-setup.exe", cfg.backup_dir);

    log_msg(&cfg, "INFO", "Telechargement...");
    report_status(&cfg, info.version, "downloading", info.setup_url);
    if (download_update(&cfg, &info, dest) != 0) {
        log_msg(&cfg, "ERROR", "Telechargement echoue");
        report_status(&cfg, info.version, "error", "download failed");
        return 1;
    }

    if (verify_checksum(dest, info.sha256) != 0) {
        log_msg(&cfg, "ERROR", "Hash invalide");
        report_status(&cfg, info.version, "error", "bad hash");
        return 1;
    }

    log_msg(&cfg, "INFO", "Installation...");
    report_status(&cfg, info.version, "installing", dest);
    if (apply_update(&cfg, &info, dest) != 0) {
        log_msg(&cfg, "ERROR", "Installation echouee");
        report_status(&cfg, info.version, "error", "install failed");
        return 1;
    }

    report_status(&cfg, info.version, "success", "installed");
    log_msg(&cfg, "INFO", "MAJ lancee — redemarrage requis");
    return 0;
}
