package com.thunnativetemplate

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

class ThunSecureRuntimeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val prefs = reactApplicationContext.getSharedPreferences(
    "thun_secure_runtime",
    Context.MODE_PRIVATE,
  )

  override fun getName(): String = "ThunSecureRuntime"

  @ReactMethod
  fun getDatabaseKey(alias: String, promise: Promise) {
    try {
      promise.resolve(getOrCreateDatabaseKey(alias))
    } catch (error: Exception) {
      promise.reject("SECURE_KEY_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getRuntimeStatus(alias: String, promise: Promise) {
    try {
      val map = Arguments.createMap().apply {
        putString("alias", alias)
        putBoolean("keystoreBacked", true)
        putBoolean("nativeModuleAvailable", true)
        putBoolean("storedKeyPresent", hasStoredDatabaseKey(alias))
      }
      promise.resolve(map)
    } catch (error: Exception) {
      promise.reject("SECURE_STATUS_ERROR", error.message, error)
    }
  }

  private fun hasStoredDatabaseKey(alias: String): Boolean {
    return prefs.contains(ciphertextKey(alias)) && prefs.contains(ivKey(alias))
  }

  private fun getOrCreateDatabaseKey(alias: String): String {
    if (hasStoredDatabaseKey(alias)) {
      return decryptStoredDatabaseKey(alias)
    }

    val databaseKey = ByteArray(32).also {
      java.security.SecureRandom().nextBytes(it)
    }
    val encodedDatabaseKey = Base64.encodeToString(databaseKey, Base64.NO_WRAP)

    val cipher = Cipher.getInstance(TRANSFORMATION).apply {
      init(Cipher.ENCRYPT_MODE, getOrCreateKey(alias))
    }

    val encrypted = cipher.doFinal(encodedDatabaseKey.toByteArray(StandardCharsets.UTF_8))
    prefs.edit()
      .putString(ciphertextKey(alias), Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .putString(ivKey(alias), Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .apply()

    return encodedDatabaseKey
  }

  private fun decryptStoredDatabaseKey(alias: String): String {
    val encrypted = prefs.getString(ciphertextKey(alias), null)
      ?: throw IllegalStateException("Encrypted database key missing for alias $alias")
    val iv = prefs.getString(ivKey(alias), null)
      ?: throw IllegalStateException("Database key IV missing for alias $alias")

    val cipher = Cipher.getInstance(TRANSFORMATION).apply {
      init(
        Cipher.DECRYPT_MODE,
        getOrCreateKey(alias),
        javax.crypto.spec.GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
      )
    }

    val plaintext = cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP))
    return String(plaintext, StandardCharsets.UTF_8)
  }

  private fun getOrCreateKey(alias: String): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val fullAlias = aliasName(alias)

    val existing = keyStore.getKey(fullAlias, null)
    if (existing is SecretKey) {
      return existing
    }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      fullAlias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()

    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  private fun aliasName(alias: String): String = "thun.$alias"

  private fun ciphertextKey(alias: String): String = "ciphertext.$alias"

  private fun ivKey(alias: String): String = "iv.$alias"

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}
