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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
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

// ---- Light "smooth white SaaS" palette ----
private val Brand = Color(0xFF3B6EF6)
private val BrandDark = Color(0xFF2F5BE0)
private val BrandSoft = Color(0xFFF0F4FF)
private val Bg = Color(0xFFF7F8FB)
private val White = Color.White
private val Ink = Color(0xFF0F172A)
private val Muted = Color(0xFF64748B)
private val Border = Color(0xFFECEEF3)
private val Field = Color(0xFFF4F6FA)
private val Success = Color(0xFF16A34A)
private val Danger = Color(0xFFDC2626)

private val CardShape = RoundedCornerShape(24.dp)
private val FieldShape = RoundedCornerShape(16.dp)

private val AppColors = lightColorScheme(
    primary = Brand, onPrimary = White, background = Bg, onBackground = Ink,
    surface = White, onSurface = Ink, surfaceVariant = Field, onSurfaceVariant = Muted,
    outline = Border, outlineVariant = Border,
    secondaryContainer = BrandSoft, onSecondaryContainer = BrandDark,
    error = Danger,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(this)
        setContent {
            MaterialTheme(colorScheme = AppColors) {
                Surface(Modifier.fillMaxSize(), color = Bg) { App() }
            }
        }
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
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(22.dp))
                .background(Brush.linearGradient(listOf(Brand, BrandDark))),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Storefront, null, tint = White, modifier = Modifier.size(36.dp)) }
        Spacer(Modifier.height(18.dp))
        Text("Akun Instan", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(20.dp))
        CircularProgressIndicator(color = Brand, strokeWidth = 3.dp)
    }
}

// Rounded filled text field used across the app
@Composable
fun SmoothField(
    value: String, onValueChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier,
    singleLine: Boolean = true, leading: (@Composable () -> Unit)? = null, placeholder: (@Composable () -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, visualTransformation: androidx.compose.ui.text.input.VisualTransformation =
        androidx.compose.ui.text.input.VisualTransformation.None,
) {
    OutlinedTextField(
        value, onValueChange, modifier = modifier,
        shape = FieldShape, singleLine = singleLine, leadingIcon = leading, placeholder = placeholder,
        keyboardOptions = keyboardOptions, visualTransformation = visualTransformation,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = White, unfocusedContainerColor = White,
            focusedBorderColor = Brand, unfocusedBorderColor = Border,
            focusedLabelColor = Brand, cursorColor = Brand,
        ),
        label = { Text(hint) },
    )
}

@Composable
fun LoginScreen(onLogin: (User) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().padding(24.dp).systemBarsPadding().imePadding(),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(64.dp).clip(RoundedCornerShape(20.dp))
                .background(Brush.linearGradient(listOf(Brand, BrandDark))),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Storefront, null, tint = White, modifier = Modifier.size(32.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Selamat datang", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
        Text("Masuk untuk belanja akun, top up saldo, dan cek pesanan.", color = Muted)
        Spacer(Modifier.height(28.dp))
        SmoothField(email, { email = it.trim() }, "Email", Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        Spacer(Modifier.height(14.dp))
        SmoothField(pass, { pass = it }, "Password", Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (error.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(22.dp))
        Button(
            enabled = !loading && email.isNotBlank() && pass.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(54.dp), shape = FieldShape,
            colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
            onClick = {
                loading = true; error = ""
                scope.launch {
                    runCatching { Api.login(email, pass) }.onSuccess(onLogin).onFailure { error = it.message ?: "Gagal masuk" }
                    loading = false
                }
            },
        ) { if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = White) else Text("Masuk", fontWeight = FontWeight.SemiBold) }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ openWeb(ctx, "/register") }) { Text("Daftar akun baru", color = Brand, fontWeight = FontWeight.SemiBold) }
            TextButton({ openWeb(ctx, "/lupa-password") }) { Text("Lupa password?", color = Muted) }
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
            if (detail == null) Column {
              HorizontalDivider(color = Border)
              NavigationBar(
                containerColor = White,
                tonalElevation = 0.dp,
              ) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Brand, selectedTextColor = Brand,
                            unselectedIconColor = Muted, unselectedTextColor = Muted,
                            indicatorColor = BrandSoft,
                        ),
                        icon = { Icon(t.icon, null) }, label = { Text(t.label, maxLines = 1) },
                    )
                }
              }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            val d = detail
            if (d != null) ProductDetail(d, user, onBack = { detail = null }, onBought = { bal -> onUser(user.copy(balance = bal)); detail = null; tab = Tab.Orders })
            else when (tab) {
                Tab.Home -> HomeScreen(user, onTopup = { tab = Tab.Topup }) { detail = it }
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
        if (onBack != null) IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Kembali", tint = Ink) } else Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun Loading() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Brand) }

@Composable
fun ErrorBox(msg: String, retry: () -> Unit) = Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
    Icon(Icons.Filled.CloudOff, null, tint = Muted, modifier = Modifier.size(36.dp))
    Spacer(Modifier.height(10.dp))
    Text(msg, color = Muted); Spacer(Modifier.height(12.dp)); OutlinedButton(retry, shape = FieldShape) { Text("Coba lagi") }
}

@Composable
fun HomeScreen(user: User, onTopup: () -> Unit, open: (Product) -> Unit) {
    var products by remember { mutableStateOf<List<Product>?>(null) }
    var error by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { error = ""; runCatching { Api.products() }.onSuccess { products = it }.onFailure { error = it.message ?: "Gagal memuat" } }
    Column(Modifier.fillMaxSize()) {
        // Greeting + balance hero
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(BrandSoft), contentAlignment = Alignment.Center) {
                Text((user.name.ifBlank { "P" }).take(1).uppercase(), color = BrandDark, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Halo, ${user.name.ifBlank { "Pelanggan" }}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Mau beli akun apa hari ini?", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        // Balance card
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 92.dp).clip(CardShape)
            .background(Brush.linearGradient(listOf(Color(0xFF5B8CFF), Brand, BrandDark)))) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Saldo kamu", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.labelMedium)
                    Text(rupiah(user.balance), color = White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = onTopup, shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = White, contentColor = BrandDark),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Top Up", fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        // Search
        OutlinedTextField(
            query, { query = it }, placeholder = { Text("Cari produk...") }, leadingIcon = { Icon(Icons.Filled.Search, null, tint = Muted) },
            singleLine = true, shape = FieldShape,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = White, unfocusedContainerColor = White,
                focusedBorderColor = Brand, unfocusedBorderColor = Border, cursorColor = Brand,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(10.dp))
        val list = products
        when {
            error.isNotBlank() && list == null -> ErrorBox(error) { reload++ }
            list == null -> Loading()
            else -> {
                val shown = list.filter { query.isBlank() || it.title.contains(query, true) || it.loginType.contains(query, true) }
                    .sortedBy { it.soldOut }
                LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (shown.isEmpty()) item { Text("Produk tidak ditemukan", color = Muted) }
                    items(shown, key = { it.id }) { p -> ProductCard(p) { if (!p.soldOut) open(p) } }
                }
            }
        }
    }
}

@Composable
fun ProductCard(p: Product, onClick: () -> Unit) {
    ElevatedCard(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = CardShape,
        colors = CardDefaults.elevatedCardColors(containerColor = White),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.5.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(BrandSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.ShoppingBag, null, tint = Brand, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.title, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (p.loginType.isNotBlank()) Text(p.loginType, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                AssistChip(
                    {}, label = { Text(if (p.soldOut) "Habis" else "Tersedia", maxLines = 1, style = MaterialTheme.typography.labelSmall) },
                    shape = RoundedCornerShape(8.dp),
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = if (p.soldOut) Color(0xFFFEF2F2) else Color(0xFFECFDF5),
                        labelColor = if (p.soldOut) Danger else Success,
                    ),
                    border = BorderStroke(1.dp, if (p.soldOut) Color(0xFFFECACA) else Color(0xFFBBF7D0)),
                )
            }
            if (p.description.isNotBlank()) Text(p.description, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rupiah(p.price), color = Brand, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text("Stok ${p.stock} · Terjual ${p.soldCount}", color = Muted, style = MaterialTheme.typography.bodySmall)
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
            if (p.description.isNotBlank()) item {
                Text(p.description, Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp), color = Muted)
            }
            item { Text("Pilih akun", fontWeight = FontWeight.SemiBold, color = Ink) }
            items(p.accounts, key = { it.index }) { a ->
                val on = a.index in picked
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
                        .background(if (on) BrandSoft else White).border(1.dp, if (on) Brand else Border, RoundedCornerShape(18.dp))
                        .clickable { if (on) picked.remove(a.index) else picked.add(a.index) }.padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(on, { if (on) picked.remove(a.index) else picked.add(a.index) }, colors = CheckboxDefaults.colors(checkedColor = Brand, checkmarkColor = White))
                    Column(Modifier.weight(1f)) {
                        Text(a.maskedEmail.ifBlank { "Akun #${a.index}" }, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Ink)
                        if (a.agedLabel.isNotBlank()) Text(a.agedLabel, color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(rupiah(a.price), fontWeight = FontWeight.SemiBold, color = if (on) BrandDark else Ink)
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(White).padding(16.dp).navigationBarsPadding()) {
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Total ${rupiah(total)}", fontWeight = FontWeight.Bold, color = Ink)
                    Text("Saldo ${rupiah(user.balance)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    enabled = picked.isNotEmpty() && !busy, onClick = { confirm = true }, shape = FieldShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                ) { Text(if (busy) "Memproses..." else "Beli", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false },
        title = { Text("Konfirmasi pembelian", fontWeight = FontWeight.Bold) },
        text = { Text("Beli ${picked.size} akun seharga ${rupiah(total)}? Saldo akan dipotong.") },
        confirmButton = { TextButton({
            confirm = false; busy = true; error = ""
            scope.launch {
                runCatching { Api.checkout(p.id, picked.toList()) }.onSuccess(onBought).onFailure { error = it.message ?: "Gagal" }
                busy = false
            }
        }) { Text("Beli sekarang", color = Brand, fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton({ confirm = false }) { Text("Batal", color = Muted) } })
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
                    ElevatedCard(shape = CardShape, colors = CardDefaults.elevatedCardColors(containerColor = White), elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.5.dp)) {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(o.titles.joinToString(", "), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Box(Modifier.clip(RoundedCornerShape(8.dp)).background(if (o.status == "paid") Color(0xFFECFDF5) else Color(0xFFFFF7ED)).padding(horizontal = 8.dp, vertical = 3.dp)) {
                                    Text(o.status.uppercase(), color = if (o.status == "paid") Success else Color(0xFFEA580C), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                                }
                            }
                            Text("${o.createdAt} · ${rupiah(o.total)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                            o.accounts.forEach { a ->
                                val key = "${o.id}:${a.itemIndex}:${a.accountIndex}"
                                val pw = revealed[key]
                                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = Border)
                                CopyRow("Email", a.email, ctx)
                                if (pw != null) CopyRow("Password", pw, ctx)
                                else Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Password  ${a.maskedPassword}", Modifier.weight(1f), color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    TextButton({ scope.launch { runCatching { Api.revealPassword(o.id, a.itemIndex, a.accountIndex) }.onSuccess { revealed[key] = it } } }) { Text("Lihat", color = Brand, fontWeight = FontWeight.SemiBold) }
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
    Column(Modifier.weight(1f)) { Text(label, color = Muted, style = MaterialTheme.typography.labelSmall); Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Ink) }
    IconButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, value)) }) {
        Icon(Icons.Filled.ContentCopy, "Salin", tint = Brand, modifier = Modifier.size(18.dp))
    }
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
                Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp)) {
                    SmoothField(amount, { amount = it.filter(Char::isDigit).take(9) }, "Nominal (min ${rupiah(min)})", Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(10000, 25000, 50000, 100000).forEach { v ->
                            FilterChip(
                                amount == v.toString(), { amount = v.toString() }, label = { Text("${v / 1000}rb") },
                                shape = RoundedCornerShape(10.dp),
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Brand, selectedLabelColor = White,
                                    containerColor = Field, labelColor = Ink,
                                ),
                            )
                        }
                    }
                    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    enabled = !busy && (amount.toIntOrNull() ?: 0) >= min, modifier = Modifier.fillMaxWidth().height(54.dp), shape = FieldShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                    onClick = {
                        busy = true; error = ""
                        scope.launch { runCatching { Api.createTopup(amount.toInt()) }.onSuccess { payment = it; status = "pending" }.onFailure { error = it.message ?: "Gagal" }; busy = false }
                    },
                ) { Text(if (busy) "Membuat QRIS..." else "Bayar dengan QRIS", fontWeight = FontWeight.SemiBold) }
            } else {
                Text("Scan QRIS untuk membayar", fontWeight = FontWeight.SemiBold, color = Ink)
                Text(rupiah(pay.total), style = MaterialTheme.typography.headlineMedium, color = Brand, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Box(Modifier.size(260.dp).clip(RoundedCornerShape(20.dp)).background(White).border(1.dp, Border, RoundedCornerShape(20.dp)).padding(12.dp), contentAlignment = Alignment.Center) { QrImage(pay.qrImage) }
                Spacer(Modifier.height(12.dp))
                Text(
                    when (status) { "paid" -> "Pembayaran berhasil! Saldo sudah bertambah."; "expired" -> "QRIS kedaluwarsa."; else -> "Menunggu pembayaran... status dicek otomatis." },
                    color = if (status == "paid") Success else if (status == "expired") Danger else Muted,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton({ payment = null; status = ""; amount = "" }, shape = FieldShape) { Text(if (status == "paid") "Selesai" else "Buat nominal lain") }
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
                    Text(
                        m.text,
                        Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp))
                            .background(if (mine) Brand else Field).padding(12.dp),
                        color = if (mine) White else Ink,
                    )
                }
            }
            if (busy) item { Text("Asisten sedang mengetik...", color = Muted) }
        }
        HorizontalDivider(color = Border)
        Row(Modifier.fillMaxWidth().background(White).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                input, { input = it }, Modifier.weight(1f), placeholder = { Text("Tulis pesan...") }, maxLines = 4,
                shape = FieldShape,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Field, unfocusedContainerColor = Field,
                    focusedBorderColor = Brand, unfocusedBorderColor = Border, cursorColor = Brand,
                ),
            )
            Spacer(Modifier.width(6.dp))
            FilledIconButton(
                enabled = !busy && input.isNotBlank(),
                onClick = {
                    msgs += ChatMsg("user", input.trim()); input = ""; busy = true
                    scope.launch {
                        val history = msgs.drop(1).takeLast(12)
                        val reply = runCatching { Api.ask(history) }.getOrElse { it.message ?: "Asisten sedang bermasalah" }
                        msgs += ChatMsg("assistant", reply.ifBlank { "Maaf, belum ada jawaban." }); busy = false
                    }
                },
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Brand, contentColor = White, disabledContainerColor = Field, disabledContentColor = Muted),
                shape = CircleShape,
            ) { Icon(Icons.AutoMirrored.Filled.Send, "Kirim", modifier = Modifier.size(20.dp)) }
        }
    }
}

@Composable
fun ProfileRow(icon: ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(White).border(1.dp, Border, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (danger) Danger else Brand, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, Modifier.weight(1f), color = if (danger) Danger else Ink, fontWeight = if (danger) FontWeight.SemiBold else FontWeight.Normal)
        Icon(Icons.Filled.ChevronRight, null, tint = Muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun ProfileScreen(user: User, onLogout: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<Pair<String, String>?>(null) }
    info?.let { (t, b) ->
        AlertDialog(onDismissRequest = { info = null }, containerColor = White, shape = CardShape,
            title = { Text(t, fontWeight = FontWeight.Bold, color = Ink) },
            text = { Text(b, color = Muted) },
            confirmButton = { TextButton({ info = null }) { Text("Mengerti", color = Brand, fontWeight = FontWeight.SemiBold) } })
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Profil", "Kelola akun dan saldo kamu")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Hero profile card
            Box(Modifier.fillMaxWidth().clip(CardShape).background(Brush.linearGradient(listOf(Color(0xFF5B8CFF), Brand, BrandDark)))) {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(52.dp).clip(CircleShape).background(Color(0x33FFFFFF)), contentAlignment = Alignment.Center) {
                        Text((user.name.ifBlank { "P" }).take(1).uppercase(), color = White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(user.name, color = White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(user.email, color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            ElevatedCard(shape = CardShape, colors = CardDefaults.elevatedCardColors(containerColor = White), elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.5.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AccountBalanceWallet, null, tint = Brand, modifier = Modifier.size(24.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Saldo", color = Muted, style = MaterialTheme.typography.labelSmall)
                        Text(rupiah(user.balance), fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            ProfileRow(Icons.Filled.HelpOutline, "Pusat bantuan") { info = "Pusat bantuan" to "Butuh bantuan? Buka tab Bantuan untuk chat dengan asisten AI kami 24 jam. Untuk kendala pembayaran, sertakan ID pesanan saat bertanya." }
            ProfileRow(Icons.Filled.Description, "Syarat & ketentuan") { info = "Syarat & ketentuan" to "Akun yang dibeli hanya untuk penggunaan pribadi. Saldo yang sudah di-top up tidak dapat ditarik tunai. Garansi berlaku sesuai keterangan pada setiap produk." }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(White).border(1.dp, Color(0xFFFECACA), RoundedCornerShape(18.dp))
                    .clickable { scope.launch { Api.logout(); onLogout() } }.padding(horizontal = 14.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Logout, null, tint = Danger, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Text("Keluar", Modifier.weight(1f), color = Danger, fontWeight = FontWeight.SemiBold)
            }
            Text("Versi ${BuildConfig.VERSION_NAME}", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
