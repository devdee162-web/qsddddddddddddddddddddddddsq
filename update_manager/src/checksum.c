#include "checksum.h"

#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

int sha256_file(const char *path, char *hex_out, size_t hex_len) {
    if (!path || !hex_out || hex_len < 65) return -1;

    FILE *f = fopen(path, "rb");
    if (!f) return -1;

    BCRYPT_ALG_HANDLE alg = NULL;
    BCRYPT_HASH_HANDLE hash = NULL;
    UCHAR hash_obj[256];
    UCHAR digest[32];
    ULONG hash_len = 0, obj_len = 0, digest_len = 0;

    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) {
        fclose(f);
        return -1;
    }
    BCryptGetProperty(alg, BCRYPT_OBJECT_LENGTH, (PUCHAR)&obj_len, sizeof(obj_len), &hash_len, 0);
    BCryptGetProperty(alg, BCRYPT_HASH_LENGTH, (PUCHAR)&digest_len, sizeof(digest_len), &hash_len, 0);
    if (BCryptCreateHash(alg, &hash, hash_obj, obj_len, NULL, 0, 0) != 0) {
        BCryptCloseAlgorithmProvider(alg, 0);
        fclose(f);
        return -1;
    }

    unsigned char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        if (BCryptHashData(hash, buf, (ULONG)n, 0) != 0) {
            BCryptDestroyHash(hash);
            BCryptCloseAlgorithmProvider(alg, 0);
            fclose(f);
            return -1;
        }
    }
    fclose(f);

    if (BCryptFinishHash(hash, digest, digest_len, 0) != 0) {
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(alg, 0);
        return -1;
    }
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(alg, 0);

    for (ULONG i = 0; i < digest_len; i++) {
        sprintf(hex_out + i * 2, "%02x", digest[i]);
    }
    hex_out[64] = '\0';
    return 0;
}

#else
#include <openssl/sha.h>

int sha256_file(const char *path, char *hex_out, size_t hex_len) {
    if (!path || !hex_out || hex_len < 65) return -1;
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    SHA256_CTX ctx;
    SHA256_Init(&ctx);
    unsigned char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) SHA256_Update(&ctx, buf, n);
    fclose(f);
    unsigned char digest[32];
    SHA256_Final(digest, &ctx);
    for (int i = 0; i < 32; i++) sprintf(hex_out + i * 2, "%02x", digest[i]);
    hex_out[64] = '\0';
    return 0;
}
#endif

int sha256_equals_ci(const char *a, const char *b) {
    if (!a || !b) return 0;
    if (strlen(a) != 64 || strlen(b) != 64) return 0;
    for (int i = 0; i < 64; i++) {
        char ca = a[i], cb = b[i];
        if (ca >= 'A' && ca <= 'F') ca += 32;
        if (cb >= 'A' && cb <= 'F') cb += 32;
        if (ca != cb) return 0;
    }
    return 1;
}
