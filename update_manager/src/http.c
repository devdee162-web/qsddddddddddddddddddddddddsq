#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#pragma comment(lib, "winhttp.lib")
#endif

#include "http.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
static int utf8_to_wide(const char *s, WCHAR **out) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (n <= 0) return -1;
    *out = (WCHAR *)malloc((size_t)n * sizeof(WCHAR));
    if (!*out) return -1;
    MultiByteToWideChar(CP_UTF8, 0, s, -1, *out, n);
    return 0;
}

static int winhttp_request(const WCHAR *method, const char *url, const char *body, HttpResponse *out) {
    memset(out, 0, sizeof(*out));
    WCHAR *url_w = NULL;
    if (utf8_to_wide(url, &url_w) != 0) return -1;

    URL_COMPONENTS uc = {0};
    uc.dwStructSize = sizeof(uc);
    WCHAR host[512] = {0}, path[2048] = {0};
    uc.lpszHostName = host; uc.dwHostNameLength = 512;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 2048;

    if (!WinHttpCrackUrl(url_w, 0, 0, &uc)) { free(url_w); return -1; }
    free(url_w);

    INTERNET_PORT port = uc.nPort;
    if (!port) port = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? 443 : 80;

    HINTERNET ses = WinHttpOpen(L"ZcordUpdater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, NULL, NULL, 0);
    if (!ses) return -1;

    HINTERNET con = WinHttpConnect(ses, host, port, 0);
    if (!con) { WinHttpCloseHandle(ses); return -1; }

    DWORD flags = uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET req = WinHttpOpenRequest(con, method, path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!req) { WinHttpCloseHandle(con); WinHttpCloseHandle(ses); return -1; }

    LPCWSTR headers = L"Content-Type: application/json\r\nAccept: application/json\r\n";
    BOOL ok;
    if (body && wcscmp(method, L"POST") == 0) {
        ok = WinHttpSendRequest(req, headers, (DWORD)-1, (LPVOID)body, (DWORD)strlen(body), (DWORD)strlen(body), 0);
    } else {
        ok = WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    }
    if (!ok || !WinHttpReceiveResponse(req, NULL)) {
        WinHttpCloseHandle(req); WinHttpCloseHandle(con); WinHttpCloseHandle(ses);
        return -1;
    }

    DWORD status = 0, sz = sizeof(status);
    WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &status, &sz, NULL);
    out->status = (long)status;

    char *buf = NULL;
    size_t cap = 0, len = 0;
    DWORD avail = 0;
    while (WinHttpQueryDataAvailable(req, &avail) && avail > 0) {
        if (len + avail + 1 > cap) {
            cap = cap ? cap * 2 : 8192;
            if (cap < len + avail + 1) cap = len + avail + 1;
            char *nb = (char *)realloc(buf, cap);
            if (!nb) { free(buf); break; }
            buf = nb;
        }
        DWORD read = 0;
        if (!WinHttpReadData(req, buf + len, avail, &read)) break;
        len += read;
    }
    if (buf) buf[len] = '\0';
    out->data = buf;
    out->size = len;

    WinHttpCloseHandle(req);
    WinHttpCloseHandle(con);
    WinHttpCloseHandle(ses);
    return 0;
}
#endif

int http_get(const char *url, HttpResponse *out) {
#ifdef _WIN32
    return winhttp_request(L"GET", url, NULL, out);
#else
    (void)url; (void)out;
    return -1;
#endif
}

int http_download_file(const char *url, const char *dest_path) {
#ifdef _WIN32
    WCHAR *url_w = NULL;
    if (utf8_to_wide(url, &url_w) != 0) return -1;

    URL_COMPONENTS uc = {0};
    uc.dwStructSize = sizeof(uc);
    WCHAR host[512] = {0}, path[2048] = {0};
    uc.lpszHostName = host; uc.dwHostNameLength = 512;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 2048;
    if (!WinHttpCrackUrl(url_w, 0, 0, &uc)) { free(url_w); return -1; }
    free(url_w);

    INTERNET_PORT port = uc.nPort;
    if (!port) port = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? 443 : 80;

    HINTERNET ses = WinHttpOpen(L"ZcordUpdater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, NULL, NULL, 0);
    if (!ses) return -1;
    HINTERNET con = WinHttpConnect(ses, host, port, 0);
    if (!con) { WinHttpCloseHandle(ses); return -1; }
    DWORD flags = uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET req = WinHttpOpenRequest(con, L"GET", path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!req) { WinHttpCloseHandle(con); WinHttpCloseHandle(ses); return -1; }
    if (!WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(req, NULL)) {
        WinHttpCloseHandle(req); WinHttpCloseHandle(con); WinHttpCloseHandle(ses);
        return -1;
    }

    FILE *f = fopen(dest_path, "wb");
    if (!f) { WinHttpCloseHandle(req); WinHttpCloseHandle(con); WinHttpCloseHandle(ses); return -1; }

    DWORD avail = 0;
    while (WinHttpQueryDataAvailable(req, &avail) && avail > 0) {
        char *buf = (char *)malloc(avail);
        if (!buf) break;
        DWORD read = 0;
        if (WinHttpReadData(req, buf, avail, &read) && read > 0) fwrite(buf, 1, read, f);
        free(buf);
    }
    fclose(f);
    WinHttpCloseHandle(req);
    WinHttpCloseHandle(con);
    WinHttpCloseHandle(ses);
    return 0;
#else
    (void)url; (void)dest_path;
    return -1;
#endif
}

int http_post_json(const char *url, const char *json_body, HttpResponse *out) {
#ifdef _WIN32
    return winhttp_request(L"POST", url, json_body, out);
#else
    (void)url; (void)json_body; (void)out;
    return -1;
#endif
}

void http_response_free(HttpResponse *resp) {
    if (resp && resp->data) free(resp->data);
    if (resp) { resp->data = NULL; resp->size = 0; }
}
