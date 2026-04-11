/**
 * crypto_utils.h
 * BLE payload protection utilities.
 *
 * Production builds can link OpenSSL and use real AES-256-GCM encryption.
 * If OpenSSL is unavailable, the helper fails closed instead of silently
 * falling back to an insecure placeholder transform.
 */

#pragma once

#include <array>
#include <cstring>
#include <random>
#include <vector>
#include <string>
#include <cstdint>
#include <stdexcept>

#ifdef IVIS_HAVE_OPENSSL
#include <openssl/evp.h>
#endif

namespace ivis {
namespace crypto {

/**
 * Encrypts a float value (e.g. Stress Index) for BLE broadcast.
 * In a real production environment, this would interface with a 
 * Secure Element (SE) or Trusted Execution Environment (TEE).
 */
struct EncryptedPayload {
    std::vector<uint8_t> ciphertext;
    std::array<uint8_t, 12> iv{};
    std::array<uint8_t, 16> tag{};
};

inline bool isPlaceholderKey(const std::string& key) {
    return key.empty() || key.find("placeholder") != std::string::npos || key.find("production_device_key") != std::string::npos;
}

inline void fillRandom(std::array<uint8_t, 12>& iv) {
    std::random_device rd;
    for (auto& byte : iv) {
        byte = static_cast<uint8_t>(rd() & 0xFF);
    }
}

inline std::vector<uint8_t> normaliseKey(const std::string& key) {
    std::vector<uint8_t> material(32, 0);
    for (size_t i = 0; i < material.size(); ++i) {
        material[i] = static_cast<uint8_t>(key[i % key.size()]);
    }
    return material;
}

inline EncryptedPayload encryptStressLevel(float level, const std::string& key) {
    if (isPlaceholderKey(key)) {
        throw std::runtime_error("BLE encryption key is missing or placeholder");
    }

    EncryptedPayload payload{};
    fillRandom(payload.iv);

#ifdef IVIS_HAVE_OPENSSL
    const auto keyMaterial = normaliseKey(key);
    const auto* plaintext = reinterpret_cast<const uint8_t*>(&level);
    payload.ciphertext.resize(sizeof(float));

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (ctx == nullptr) {
        throw std::runtime_error("Failed to create EVP cipher context");
    }

    int outLen = 0;
    int finalLen = 0;
    const int initOk = EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr);
    const int ivOk = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(payload.iv.size()), nullptr);
    const int keyOk = EVP_EncryptInit_ex(ctx, nullptr, nullptr, keyMaterial.data(), payload.iv.data());
    const int updateOk = EVP_EncryptUpdate(ctx, payload.ciphertext.data(), &outLen, plaintext, sizeof(float));
    const int finalOk = EVP_EncryptFinal_ex(ctx, payload.ciphertext.data() + outLen, &finalLen);
    const int tagOk = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, static_cast<int>(payload.tag.size()), payload.tag.data());

    EVP_CIPHER_CTX_free(ctx);

    if (!(initOk == 1 && ivOk == 1 && keyOk == 1 && updateOk == 1 && finalOk == 1 && tagOk == 1)) {
        throw std::runtime_error("AES-256-GCM encryption failed");
    }

    payload.ciphertext.resize(static_cast<size_t>(outLen + finalLen));
    return payload;
#else
    throw std::runtime_error("BLE encryption requires OpenSSL support in this build");
#endif
}

} // namespace crypto
} // namespace ivis
