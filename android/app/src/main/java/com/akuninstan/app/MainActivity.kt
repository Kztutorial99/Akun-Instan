package com.akuninstan.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Brand = Color(0xFF2563EB)
private val Bg = Color(0xFF0B1220)
private val Card = Color(0xFF141E33)
private val Muted = Color(0xFF94A3B8)

private val AppColors = darkColorScheme(
    primary = Brand, onPrimary = Color.White, background = Bg, onBackground = Color(0xFFE2E8F0),
    surface = Card, onSurface = Color(0xFFE2E8F0), surfaceVariant = Color(0xFF1E293B), onSurfaceVariant = Muted,
    secondaryContainer = Color(0xFF1E3A8A), onSecondaryContainer = Color.White,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(this)
        setContent { MaterialTheme(colorScheme = AppColors) { Surface(Modifier.fillMaxSize(), color = Bg) { App() } } }
    }
}

enum class Tab(val label: String, val icon: ImageVector) {
    Home("Beranda", Icons.Filled.Storefront), Orders("Pesanan", Icons.Filled.ReceiptLong),
    Topup("Top Up", Icons.Filled.AccountBalanceWallet), Help("Bantuan", Icons.Filled.SupportAgent), Profile("Profil", Icons.Filled.Person)
}

fun openWeb(ctx: Context, path: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Api.BASE + path)))

@Composable
fun App() {
    var booting by remember { mutableStateOf(true) }
    var user by remember { mutableStateOf<User?>(null) }
    LaunchedEffect(Unit) { user = runCatching { Api.me() }.getOrNull(); booting = false }
    when {
        booting -> Splash()
        user == null -> LoginScreen { user = it }
        else -> MainShell(user!!, onUser = { user = it }, onLogout = { user = null })
    }
}

@Composable
fun Splash() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Akun Instan", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp)); CircularProgressIndicator()
    }
}

@Composable
fun LoginScreen(onLogin: (User) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp).systemBarsPadding().imePadding(), verticalArrangement = Arrangement.Center) {
        Text("Akun Instan", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = Brand)
        Text("Masuk untuk belanja akun, top up saldo, dan cek pesanan.", color = Muted)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(email, { email = it.trim() }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(pass, { pass = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (error.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(error, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(20.dp))
        Button(enabled = !loading && email.isNotBlank() && pass.isNotBlank(), modifier = Modifier.fillMaxWidth().height(50.dp), onClick = {
            loading = true; error = ""
            scope.launch {
                runCatching { Api.login(email, pass) }.onSuccess(onLogin).onFailure { error = it.message ?: "Gagal masuk" }
                loading = false
            }
        }) { if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White) else Text("Masuk") }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ openWeb(ctx, "/register") }) { Text("Daftar akun baru") }
            TextButton({ openWeb(ctx, "/lupa-password") }) { Text("Lupa password?") }
        }
    }
}

@Composable
fun MainShell(user: User, onUser: (User) -> Unit, onLogout: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var detail by remember { mutableStateOf<Product?>(null) }
    BackHandler(detail != null || tab != Tab.Home) { if (detail != null) detail = null else tab = Tab.Home }
    Scaffold(
        containerColor = Bg,
        bottomBar = {
            if (detail == null) NavigationBar(containerColor = Card) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(selected = tab == t, onClick = { tab = t }, icon = { Icon(t.icon, null) }, label = { Text(t.label, maxLines = 1) })
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            val d = detail
            if (d != null) ProductDetail(d, user, onBack = { detail = null }, onBought = { bal -> onUser(user.copy(balance = bal)); detail = null; tab = Tab.Orders })
            else when (tab) {
                Tab.Home -> HomeScreen(user) { detail = it }
                Tab.Orders -> OrdersScreen()
                Tab.Topup -> TopupScreen { onUser(user.copy(balance = it)) }
                Tab.Help -> ChatScreen()
                Tab.Profile -> ProfileScreen(user, onLogout)
            }
        }
    }
}

@Composable
fun Header(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Kembali") } else Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun Loading() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

@Composable
fun ErrorBox(msg: String, retry: () -> Unit) = Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
    Text(msg, color = Muted); Spacer(Modifier.height(12.dp)); OutlinedButton(retry) { Text("Coba lagi") }
}

@Composable
fun HomeScreen(user: User, open: (Product) -> Unit) {
    var products by remember { mutableStateOf<List<Product>?>(null) }
    var error by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { error = ""; runCatching { Api.products() }.onSuccess { products = it }.onFailure { error = it.message ?: "Gagal memuat" } }
    Column(Modifier.fillMaxSize()) {
        Header("Halo, ${user.name.ifBlank { "Pelanggan" }}", "Saldo ${rupiah(user.balance)}")
        OutlinedTextField(query, { query = it }, placeholder = { Text("Cari produk...") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
            singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        Spacer(Modifier.height(8.dp))
        val list = products
        when {
            error.isNotBlank() && list == null -> ErrorBox(error) { reload++ }
            list == null -> Loading()
            else -> {
                val shown = list.filter { query.isBlank() || it.title.contains(query, true) || it.loginType.contains(query, true) }
                    .sortedBy { it.soldOut }
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (shown.isEmpty()) item { Text("Produk tidak ditemukan", color = Muted) }
                    items(shown, key = { it.id }) { p -> ProductCard(p) { if (!p.soldOut) open(p) } }
                }
            }
        }
    }
}

@Composable
fun ProductCard(p: Product, onClick: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth().clickable(onClick = onClick), colors = CardDefaults.elevatedCardColors(containerColor = Card)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (p.loginType.isNotBlank()) AssistChip({}, label = { Text(p.loginType, maxLines = 1) })
            }
            if (p.description.isNotBlank()) Text(p.description, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rupiah(p.price), color = Brand, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text(if (p.soldOut) "Habis" else "Stok ${p.stock} · Terjual ${p.soldCount}", color = if (p.soldOut) MaterialTheme.colorScheme.error else Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
fun ProductDetail(p: Product, user: User, onBack: () -> Unit, onBought: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    val picked = remember { mutableStateListOf<Int>() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    val total = p.accounts.filter { it.index in picked }.sumOf { it.price }
    Column(Modifier.fillMaxSize()) {
        Header(p.title, p.loginType, onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (p.description.isNotBlank()) item { Text(p.description, color = Muted) }
            item { Text("Pilih akun", fontWeight = FontWeight.SemiBold) }
            items(p.accounts, key = { it.index }) { a ->
                val on = a.index in picked
                Row(Modifier.fillMaxWidth().background(if (on) Color(0xFF1E3A8A) else Card, RoundedCornerShape(12.dp))
                    .clickable { if (on) picked.remove(a.index) else picked.add(a.index) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(on, { if (on) picked.remove(a.index) else picked.add(a.index) })
                    Column(Modifier.weight(1f)) {
                        Text(a.maskedEmail.ifBlank { "Akun #${a.index}" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (a.agedLabel.isNotBlank()) Text(a.agedLabel, color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(rupiah(a.price), fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(Card).padding(16.dp).navigationBarsPadding()) {
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Total ${rupiah(total)}", fontWeight = FontWeight.Bold)
                    Text("Saldo ${rupiah(user.balance)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Button(enabled = picked.isNotEmpty() && !busy, onClick = { confirm = true }) { Text(if (busy) "Memproses..." else "Beli") }
            }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false },
        title = { Text("Konfirmasi pembelian") },
        text = { Text("Beli ${picked.size} akun seharga ${rupiah(total)}? Saldo akan dipotong.") },
        confirmButton = { TextButton({
            confirm = false; busy = true; error = ""
            scope.launch {
                runCatching { Api.checkout(p.id, picked.toList()) }.onSuccess(onBought).onFailure { error = it.message ?: "Gagal" }
                busy = false
            }
        }) { Text("Beli sekarang") } },
        dismissButton = { TextButton({ confirm = false }) { Text("Batal") } })
}

@Composable
fun OrdersScreen() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var orders by remember { mutableStateOf<List<Order>?>(null) }
    var error by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    val revealed = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(reload) { error = ""; runCatching { Api.orders() }.onSuccess { orders = it.first }.onFailure { error = it.message ?: "Gagal memuat" } }
    Column(Modifier.fillMaxSize()) {
        Header("Pesanan saya", "Detail akun yang sudah kamu beli")
        val list = orders
        when {
            error.isNotBlank() && list == null -> ErrorBox(error) { reload++ }
            list == null -> Loading()
            list.isEmpty() -> ErrorBox("Belum ada pesanan") { reload++ }
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(list, key = { it.id }) { o ->
                    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Card)) {
                        Column(Modifier.padding(16.dp)) {
                            Row { Text(o.titles.joinToString(", "), Modifier.weight(1f), fontWeight = FontWeight.SemiBold); Text(o.status.uppercase(), color = Brand, style = MaterialTheme.typography.labelSmall) }
                            Text("${o.createdAt} · ${rupiah(o.total)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                            o.accounts.forEach { a ->
                                val key = "${o.id}:${a.itemIndex}:${a.accountIndex}"
                                val pw = revealed[key]
                                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = Color(0xFF1E293B))
                                CopyRow("Email", a.email, ctx)
                                if (pw != null) CopyRow("Password", pw, ctx)
                                else Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Password  ${a.maskedPassword}", Modifier.weight(1f), color = Muted)
                                    TextButton({ scope.launch { runCatching { Api.revealPassword(o.id, a.itemIndex, a.accountIndex) }.onSuccess { revealed[key] = it } } }) { Text("Lihat") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CopyRow(label: String, value: String, ctx: Context) = Row(verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(label, color = Muted, style = MaterialTheme.typography.labelSmall); Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    IconButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, value)) }) { Icon(Icons.Filled.ContentCopy, "Salin") }
}

@Composable
fun TopupScreen(onBalance: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<TopupInfo?>(null) }
    var amount by remember { mutableStateOf("") }
    var payment by remember { mutableStateOf<Payment?>(null) }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { Api.topupInfo() }.onSuccess { info = it; onBalance(it.balance) }.onFailure { error = it.message ?: "" } }
    val pay = payment
    LaunchedEffect(pay?.refId) {
        if (pay == null) return@LaunchedEffect
        while (status != "paid" && status != "expired") {
            delay(5000)
            runCatching { Api.topupStatus(pay.refId) }.onSuccess { (s, bal) -> status = s; if (s == "paid") onBalance(bal) }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Header("Top up saldo", info?.let { "Saldo sekarang ${rupiah(it.balance)}" })
        Column(Modifier.padding(16.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            if (pay == null) {
                val min = info?.minTopup ?: 10000
                OutlinedTextField(amount, { amount = it.filter(Char::isDigit).take(9) }, label = { Text("Nominal (min ${rupiah(min)})") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(10000, 25000, 50000, 100000).forEach { v -> FilterChip(amount == v.toString(), { amount = v.toString() }, label = { Text("${v / 1000}rb") }) }
                }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp))
                Spacer(Modifier.height(16.dp))
                Button(enabled = !busy && (amount.toIntOrNull() ?: 0) >= min, modifier = Modifier.fillMaxWidth().height(50.dp), onClick = {
                    busy = true; error = ""
                    scope.launch { runCatching { Api.createTopup(amount.toInt()) }.onSuccess { payment = it; status = "pending" }.onFailure { error = it.message ?: "Gagal" }; busy = false }
                }) { Text(if (busy) "Membuat QRIS..." else "Bayar dengan QRIS") }
            } else {
                Text("Scan QRIS untuk membayar", fontWeight = FontWeight.SemiBold)
                Text(rupiah(pay.total), style = MaterialTheme.typography.headlineMedium, color = Brand, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Box(Modifier.size(260.dp).background(Color.White, RoundedCornerShape(16.dp)).padding(12.dp), contentAlignment = Alignment.Center) { QrImage(pay.qrImage) }
                Spacer(Modifier.height(12.dp))
                Text(when (status) { "paid" -> "Pembayaran berhasil! Saldo sudah bertambah."; "expired" -> "QRIS kedaluwarsa."; else -> "Menunggu pembayaran... status dicek otomatis." },
                    color = if (status == "paid") Color(0xFF22C55E) else Muted)
                Spacer(Modifier.height(12.dp))
                OutlinedButton({ payment = null; status = ""; amount = "" }) { Text(if (status == "paid") "Selesai" else "Buat nominal lain") }
            }
        }
    }
}

@Composable
fun QrImage(src: String) {
    if (src.startsWith("data:")) {
        val bmp = remember(src) { runCatching { Base64.decode(src.substringAfter(","), Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull() }
        if (bmp != null) Image(bmp.asImageBitmap(), "QRIS", Modifier.fillMaxSize()) else Text("QR tidak tersedia", color = Color.Black)
    } else if (src.isNotBlank()) AsyncImage(model = src, contentDescription = "QRIS", modifier = Modifier.fillMaxSize())
    else Text("QR tidak tersedia", color = Color.Black)
}

@Composable
fun ChatScreen() {
    val scope = rememberCoroutineScope()
    val msgs = remember { mutableStateListOf(ChatMsg("assistant", "Halo! Saya asisten Akun Instan. Ada yang bisa dibantu soal pesanan, saldo, atau akun?")) }
    var input by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LaunchedEffect(msgs.size) { listState.animateScrollToItem(msgs.size) }
    Column(Modifier.fillMaxSize().imePadding()) {
        Header("Bantuan AI", "Tanya apa saja seputar Akun Instan")
        LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(msgs) { m ->
                val mine = m.role == "user"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    Text(m.text, Modifier.widthIn(max = 300.dp).background(if (mine) Brand else Card, RoundedCornerShape(14.dp)).padding(12.dp))
                }
            }
            if (busy) item { Text("Asisten sedang mengetik...", color = Muted) }
        }
        Row(Modifier.fillMaxWidth().background(Card).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(input, { input = it }, Modifier.weight(1f), placeholder = { Text("Tulis pesan...") }, maxLines = 4)
            IconButton(enabled = !busy && input.isNotBlank(), onClick = {
                msgs += ChatMsg("user", input.trim()); input = ""; busy = true
                scope.launch {
                    val history = msgs.drop(1).takeLast(12)
                    val reply = runCatching { Api.ask(history) }.getOrElse { it.message ?: "Asisten sedang bermasalah" }
                    msgs += ChatMsg("assistant", reply.ifBlank { "Maaf, belum ada jawaban." }); busy = false
                }
            }) { Icon(Icons.AutoMirrored.Filled.Send, "Kirim", tint = Brand) }
        }
    }
}

@Composable
fun ProfileScreen(user: User, onLogout: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Header("Profil")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Card), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(user.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(user.email, color = Muted)
                    Spacer(Modifier.height(8.dp)); Text("Saldo ${rupiah(user.balance)}", color = Brand, fontWeight = FontWeight.SemiBold)
                }
            }
            OutlinedButton({ openWeb(ctx, "/help") }, Modifier.fillMaxWidth()) { Text("Pusat bantuan") }
            OutlinedButton({ openWeb(ctx, "/terms") }, Modifier.fillMaxWidth()) { Text("Syarat & ketentuan") }
            Button({ scope.launch { Api.logout(); onLogout() } }, Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text("Keluar") }
            Text("Versi ${BuildConfig.VERSION_NAME}", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
