package com.akuninstan.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiException(val code: Int, message: String) : Exception(message)

/** Menyimpan cookie sesi login di perangkat supaya pelanggan tidak perlu login ulang. */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val cookies = mutableMapOf<String, Cookie>()

    init {
        prefs.getStringSet("cookies", emptySet())!!.forEach { raw ->
            val url = HttpUrl.Builder().scheme("https").host(Api.HOST).build()
            Cookie.parse(url, raw)?.let { if (it.expiresAt > System.currentTimeMillis()) cookies[it.name] = it }
        }
    }

    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { c -> if (c.value.isEmpty() || c.expiresAt < System.currentTimeMillis()) this.cookies.remove(c.name) else this.cookies[c.name] = c }
        persist()
    }

    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> =
        cookies.values.filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }

    @Synchronized fun clear() { cookies.clear(); persist() }

    private fun persist() { prefs.edit().putStringSet("cookies", cookies.values.map { it.toString() }.toSet()).apply() }
}

object Api {
    val BASE: String = BuildConfig.API_BASE
    val HOST: String = BASE.removePrefix("https://").substringBefore("/")
    private lateinit var jar: PersistentCookieJar
    private lateinit var http: OkHttpClient
    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    fun init(context: Context) {
        if (::http.isInitialized) return
        jar = PersistentCookieJar(context.applicationContext)
        http = OkHttpClient.Builder()
            .cookieJar(jar)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }

    private suspend fun call(method: String, path: String, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(BASE + path)
            .header("Accept", "application/json")
            .header("X-Client", "akuninstan-android")
        val rb = body?.toString()?.toRequestBody(JSON_TYPE)
        builder.method(method, if (method == "GET") null else (rb ?: "{}".toRequestBody(JSON_TYPE)))
        http.newCall(builder.build()).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!res.isSuccessful) throw ApiException(res.code, json.optString("error").ifBlank { "Terjadi kesalahan (${res.code})" })
            json
        }
    }

    // ── Akun ──
    suspend fun me(): User? = call("GET", "/api/auth").optJSONObject("user")?.let(User::from)
    suspend fun login(email: String, password: String): User =
        User.from(call("POST", "/api/auth", JSONObject().put("action", "login").put("email", email).put("password", password)).getJSONObject("user"))
    suspend fun loginGoogle(accessToken: String): User =
        User.from(call("POST", "/api/auth", JSONObject().put("action", "google").put("accessToken", accessToken)).getJSONObject("user"))
    suspend fun logout() { runCatching { call("DELETE", "/api/auth") }; jar.clear() }

    // ── Katalog ──
    suspend fun products(): List<Product> {
        val arr = call("GET", "/api/data").optJSONArray("products") ?: JSONArray()
        return (0 until arr.length()).map { Product.from(arr.getJSONObject(it)) }
    }

    // ── Pesanan ──
    suspend fun checkout(productId: String, accountIndexes: List<Int>): Int {
        val item = JSONObject().put("id", productId).put("accounts", JSONArray(accountIndexes))
        return call("POST", "/api/orders", JSONObject().put("items", JSONArray().put(item))).optInt("balance")
    }
    suspend fun orders(): Pair<List<Order>, Int> {
        val json = call("GET", "/api/orders")
        val arr = json.optJSONArray("orders") ?: JSONArray()
        return (0 until arr.length()).map { Order.from(arr.getJSONObject(it)) } to json.optInt("balance")
    }
    suspend fun revealPassword(orderId: String, itemIndex: Int, accountIndex: Int): String =
        call("POST", "/api/orders?resource=secret", JSONObject().put("orderId", orderId).put("itemIndex", itemIndex).put("accountIndex", accountIndex)).optString("password")

    // ── Top up QRIS ──
    suspend fun topupInfo(): TopupInfo = TopupInfo.from(call("GET", "/api/topup"))
    suspend fun createTopup(amount: Int): Payment =
        Payment.from(call("POST", "/api/topup", JSONObject().put("amount", amount).put("note", "Android")).getJSONObject("payment"))
    suspend fun topupStatus(refId: String): Pair<String, Int> {
        val j = call("GET", "/api/topup?resource=status&ref=" + java.net.URLEncoder.encode(refId, "UTF-8"))
        return j.optString("status") to j.optInt("balance")
    }

    // ── AI Support ──
    suspend fun ask(history: List<ChatMsg>): String {
        val msgs = JSONArray()
        history.forEach { msgs.put(JSONObject().put("role", it.role).put("content", it.text)) }
        return call("POST", "/api/assistant", JSONObject().put("messages", msgs)).optString("reply")
    }
}
