#include "updater.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdarg.h>

static void trim(char *s) {
    if (!s) return;
    size_t n = strlen(s);
    while (n && isspace((unsigned char)s[n - 1])) s[--n] = '\0';
    char *p = s;
    while (*p && isspace((unsigned char)*p)) p++;
    if (p != s) memmove(s, p, strlen(p) + 1);
}

static int json_get_string(const char *json, const char *key, char *out, size_t out_len) {
    char pat[128];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return -1;
    p = strchr(p + strlen(pat), ':');
    if (!p) return -1;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '"') return -1;
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < out_len) {
        if (*p == '\\' && p[1]) { out[i++] = *++p; p++; continue; }
        out[i++] = *p++;
    }
    out[i] = '\0';
    return 0;
}

static int json_get_bool(const char *json, const char *key, int *out) {
    char pat[128];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return -1;
    p = strchr(p, ':');
    if (!p) return -1;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (strncmp(p, "true", 4) == 0) { *out = 1; return 0; }
    if (strncmp(p, "false", 5) == 0) { *out = 0; return 0; }
    return -1;
}

static int json_get_int64(const char *json, const char *key, long long *out) {
    char pat[128];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return -1;
    p = strchr(p, ':');
    if (!p) return -1;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    *out = _strtoi64(p, NULL, 10);
    return 0;
}

int version_compare(const char *a, const char *b) {
    int av[8] = {0}, bv[8] = {0};
    char ab[64], bb[64];
    strncpy(ab, a ? a : "0", sizeof(ab) - 1);
    strncpy(bb, b ? b : "0", sizeof(bb) - 1);
    if (ab[0] == 'v' || ab[0] == 'V') memmove(ab, ab + 1, strlen(ab));
    if (bb[0] == 'v' || bb[0] == 'V') memmove(bb, bb + 1, strlen(bb));
    sscanf(ab, "%d.%d.%d", &av[0], &av[1], &av[2]);
    sscanf(bb, "%d.%d.%d", &bv[0], &bv[1], &bv[2]);
    for (int i = 0; i < 3; i++) {
        if (av[i] > bv[i]) return 1;
        if (av[i] < bv[i]) return -1;
    }
    return 0;
}

int version_read(const char *path, char *out, size_t out_len) {
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(out, (int)out_len, f)) { fclose(f); return -1; }
    fclose(f);
    trim(out);
    return 0;
}

int config_load(UpdaterConfig *cfg, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *json = (char *)malloc((size_t)sz + 1);
    if (!json) { fclose(f); return -1; }
    fread(json, 1, (size_t)sz, f);
    json[sz] = '\0';
    fclose(f);

    memset(cfg, 0, sizeof(*cfg));
    json_get_string(json, "serverUrl", cfg->server_url, sizeof(cfg->server_url));
    json_get_string(json, "installDir", cfg->install_dir, sizeof(cfg->install_dir));
    json_get_string(json, "currentVersion", cfg->current_version, sizeof(cfg->current_version));
    json_get_string(json, "backupDir", cfg->backup_dir, sizeof(cfg->backup_dir));
    json_get_string(json, "logFile", cfg->log_file, sizeof(cfg->log_file));
    int ab = 1;
    json_get_bool(json, "autoBackup", &ab);
    cfg->auto_backup = ab;
    free(json);
    return 0;
}

int config_save(const UpdaterConfig *cfg, const char *path) {
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f,
        "{\n"
        "  \"serverUrl\": \"%s\",\n"
        "  \"installDir\": \"%s\",\n"
        "  \"currentVersion\": \"%s\",\n"
        "  \"backupDir\": \"%s\",\n"
        "  \"logFile\": \"%s\",\n"
        "  \"autoBackup\": %s\n"
        "}\n",
        cfg->server_url, cfg->install_dir, cfg->current_version,
        cfg->backup_dir, cfg->log_file, cfg->auto_backup ? "true" : "false");
    fclose(f);
    return 0;
}

void log_msg(const UpdaterConfig *cfg, const char *level, const char *fmt, ...) {
    char line[2048];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(line, sizeof(line), fmt, ap);
    va_end(ap);

    printf("[%s] %s\n", level, line);
    if (cfg && cfg->log_file[0]) {
        FILE *f = fopen(cfg->log_file, "a");
        if (f) {
            fprintf(f, "[%s] %s\n", level, line);
            fclose(f);
        }
    }
}

#include "http.h"
#include "checksum.h"

int check_for_updates(const UpdaterConfig *cfg, UpdateInfo *info) {
    memset(info, 0, sizeof(*info));
    char url[ZCORD_MAX_URL];
    snprintf(url, sizeof(url), "%s/api/check?version=%s", cfg->server_url, cfg->current_version);

    HttpResponse resp = {0};
    if (http_get(url, &resp) != 0 || resp.status != 200 || !resp.data) {
        http_response_free(&resp);
        return -1;
    }

    json_get_bool(resp.data, "available", &info->available);
    json_get_string(resp.data, "version", info->version, sizeof(info->version));
    json_get_string(resp.data, "name", info->name, sizeof(info->name));
    json_get_string(resp.data, "type", info->type, sizeof(info->type));
    json_get_string(resp.data, "setupUrl", info->setup_url, sizeof(info->setup_url));
    json_get_string(resp.data, "manifestUrl", info->manifest_url, sizeof(info->manifest_url));
    json_get_string(resp.data, "notes", info->notes, sizeof(info->notes));
    json_get_string(resp.data, "sha256", info->sha256, sizeof(info->sha256));
    json_get_int64(resp.data, "fileSize", &info->file_size);
    json_get_bool(resp.data, "force", &info->force);

    http_response_free(&resp);
    return info->available ? 1 : 0;
}

int download_update(const UpdaterConfig *cfg, const UpdateInfo *info, const char *dest) {
    (void)cfg;
    return http_download_file(info->setup_url, dest);
}

int verify_checksum(const char *file, const char *expected_sha256) {
    if (!expected_sha256 || !expected_sha256[0]) return 0;
    char hash[65];
    if (sha256_file(file, hash, sizeof(hash)) != 0) return -1;
    return sha256_equals_ci(hash, expected_sha256) ? 0 : -1;
}

#ifdef _WIN32
#include <shellapi.h>
#endif

int apply_update(const UpdaterConfig *cfg, const UpdateInfo *info, const char *package_path) {
    (void)info;
    log_msg(cfg, "INFO", "Installation: %s", package_path);

#ifdef _WIN32
    HINSTANCE r = ShellExecuteA(NULL, "open", package_path,
        "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /SP-",
        cfg->install_dir, SW_HIDE);
    if ((INT_PTR)r <= 32) return -1;
    return 0;
#else
    (void)package_path;
    return -1;
#endif
}

int report_status(const UpdaterConfig *cfg, const char *version, const char *status, const char *detail) {
    char url[ZCORD_MAX_URL];
    char body[2048];
    snprintf(url, sizeof(url), "%s/api/report", cfg->server_url);
    snprintf(body, sizeof(body),
        "{\"version\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\",\"clientVersion\":\"%s\"}",
        version ? version : "", status ? status : "", detail ? detail : "", cfg->current_version);
    HttpResponse resp = {0};
    int ok = http_post_json(url, body, &resp);
    http_response_free(&resp);
    return ok;
}
