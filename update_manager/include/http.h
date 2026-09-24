#ifndef ZCORD_HTTP_H
#define ZCORD_HTTP_H

#include <stddef.h>

typedef struct {
    char *data;
    size_t size;
    long status;
} HttpResponse;

int http_get(const char *url, HttpResponse *out);
int http_download_file(const char *url, const char *dest_path);
int http_post_json(const char *url, const char *json_body, HttpResponse *out);
void http_response_free(HttpResponse *resp);

#endif
