#ifndef ZCORD_UPDATER_H
#define ZCORD_UPDATER_H

#include <stddef.h>

#define ZCORD_MAX_PATH 1024
#define ZCORD_MAX_URL 2048
#define ZCORD_MAX_VER 64

typedef struct {
    char server_url[ZCORD_MAX_URL];
    char install_dir[ZCORD_MAX_PATH];
    char current_version[ZCORD_MAX_VER];
    char backup_dir[ZCORD_MAX_PATH];
    char log_file[ZCORD_MAX_PATH];
    int auto_backup;
} UpdaterConfig;

typedef struct {
    char version[ZCORD_MAX_VER];
    char name[256];
    char type[32];
    char setup_url[ZCORD_MAX_URL];
    char manifest_url[ZCORD_MAX_URL];
    char notes[1024];
    char sha256[128];
    long long file_size;
    int force;
    int available;
} UpdateInfo;

int config_load(UpdaterConfig *cfg, const char *path);
int config_save(const UpdaterConfig *cfg, const char *path);

int version_read(const char *path, char *out, size_t out_len);
int version_compare(const char *a, const char *b);

int check_for_updates(const UpdaterConfig *cfg, UpdateInfo *info);
int download_update(const UpdaterConfig *cfg, const UpdateInfo *info, const char *dest);
int verify_checksum(const char *file, const char *expected_sha256);
int apply_update(const UpdaterConfig *cfg, const UpdateInfo *info, const char *package_path);
int report_status(const UpdaterConfig *cfg, const char *version, const char *status, const char *detail);

void log_msg(const UpdaterConfig *cfg, const char *level, const char *fmt, ...);

#endif
