package com.akuninstan.app

import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

fun rupiah(n: Int): String = "Rp" + NumberFormat.getInstance(Locale("in", "ID")).format(n)

data class User(
    val id: String, val name: String, val email: String, val balance: Int,
    val phone: String = "", val avatar: String = "", val provider: String = "email",
) {
    val isGoogle get() = provider == "google"
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("email", email).put("balance", balance)
        .put("phone", phone).put("avatar", avatar).put("provider", provider)
    companion object {
        fun from(j: JSONObject) = User(
            j.optString("id"), j.optString("name"), j.optString("email"), j.optInt("balance"),
            j.optString("phone"), j.optString("avatar"), j.optString("provider").ifBlank { "email" },
        )
    }
}

data class AccountSlot(val index: Int, val price: Int, val maskedEmail: String, val agedLabel: String)

data class Product(
    val id: String, val title: String, val description: String, val loginType: String,
    val price: Int, val stock: Int, val soldOut: Boolean, val soldCount: Int,
    val ratingAvg: Double, val accounts: List<AccountSlot>,
) {
    companion object {
        fun from(j: JSONObject): Product {
            val arr = j.optJSONArray("accounts")
            val accounts = if (arr == null) emptyList() else (0 until arr.length()).map {
                val a = arr.getJSONObject(it)
                AccountSlot(a.optInt("index"), a.optInt("price"), a.optString("maskedEmail"), a.optString("agedLabel"))
            }
            return Product(
                j.optString("id"), j.optString("title"), j.optString("description"), j.optString("loginType"),
                j.optInt("price"), j.optInt("stock"), j.optBoolean("soldOut"), j.optInt("soldCount"),
                j.optDouble("ratingAvg", 0.0), accounts,
            )
        }
    }
}

data class OrderAccount(val itemIndex: Int, val accountIndex: Int, val email: String, val maskedPassword: String, val price: Int)
data class Order(val id: String, val total: Int, val status: String, val createdAt: String, val titles: List<String>, val accounts: List<OrderAccount>) {
    companion object {
        fun from(j: JSONObject): Order {
            val items = j.optJSONArray("items")
            val titles = mutableListOf<String>()
            val accounts = mutableListOf<OrderAccount>()
            if (items != null) for (i in 0 until items.length()) {
                val it = items.getJSONObject(i)
                titles += it.optString("title").ifBlank { "Produk" }
                val accs = it.optJSONArray("accounts") ?: continue
                for (k in 0 until accs.length()) {
                    val a = accs.getJSONObject(k)
                    accounts += OrderAccount(i, k, a.optString("email"), a.optString("maskedPassword"), a.optInt("price"))
                }
            }
            return Order(j.optString("id"), j.optInt("total"), j.optString("status"), j.optString("createdAt").take(10), titles, accounts)
        }
    }
}

data class TopupInfo(val balance: Int, val minTopup: Int, val pendingCount: Int) {
    companion object {
        fun from(j: JSONObject) = TopupInfo(j.optInt("balance"), j.optInt("minTopup", 10000), j.optInt("pendingCount"))
    }
}

data class Payment(val refId: String, val qrImage: String, val qrString: String, val total: Int, val expired: String) {
    companion object {
        fun from(j: JSONObject) = Payment(j.optString("refId"), j.optString("qrImage"), j.optString("qrString"), j.optInt("totalBayar"), j.optString("expired"))
    }
}

data class ChatMsg(val role: String, val text: String)
