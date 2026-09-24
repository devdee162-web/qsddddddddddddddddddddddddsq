#ifndef ZCORD_CHECKSUM_H
#define ZCORD_CHECKSUM_H

#include <stddef.h>

int sha256_file(const char *path, char *hex_out, size_t hex_len);
int sha256_equals_ci(const char *a, const char *b);

#endif
