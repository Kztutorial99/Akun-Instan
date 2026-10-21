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
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
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
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.graphics.Bitmap
import androidx.compose.ui.layout.ContentScale
import java.io.ByteArrayOutputStream
import org.json.JSONObject
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ---- Tema putih smooth SaaS ----
private val Brand = Color(0xFF2563EB)
private val BrandDark = Color(0xFF1D3FAE)
private val Navy = Color(0xFF0B1B3F)
private val Navy2 = Color(0xFF14295C)
private val BrandSoft = Color(0xFFEEF3FF)
private val Bg = Color(0xFFF6F7F9)
private val White = Color.White
private val Ink = Color(0xFF0F172A)
private val Muted = Color(0xFF64748B)
private val Border = Color(0xFFE6E8EE)
private val Field = Color(0xFFF4F6FA)
private val Success = Color(0xFF16A34A)
private val SuccessSoft = Color(0xFFECFDF5)
private val Danger = Color(0xFFDC2626)
private val DangerSoft = Color(0xFFFEF2F2)
private val Warning = Color(0xFFEA580C)
private val WarningSoft = Color(0xFFFFF7ED)

private val CardShape = RoundedCornerShape(20.dp)
private val FieldShape = RoundedCornerShape(16.dp)
private val ChipShape = RoundedCornerShape(12.dp)

private val AppColors = lightColorScheme(
    primary = Brand, onPrimary = White, background = Bg, onBackground = Ink,
    surface = White, onSurface = Ink, surfaceVariant = Field, onSurfaceVariant = Muted,
    outline = Border, outlineVariant = Border,
    secondaryContainer = BrandSoft, onSecondaryContainer = BrandDark,
    error = Danger,
)

class MainActivity : ComponentActivity() {
    private val googleToken = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(this)
        handleIntent(intent)
        setContent {
            MaterialTheme(colorScheme = AppColors) {
                Surface(Modifier.fillMaxSize(), color = Bg) {
                    App(googleToken.value, onTokenConsumed = { googleToken.value = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        val d = i?.data ?: return
        if (d.scheme == "akuninstan" && d.host == "auth") {
            val token = d.getQueryParameter("token")
            if (!token.isNullOrBlank()) googleToken.value = token
        }
    }
}

/** Efek tekan halus: kartu/tombol sedikit mengecil saat disentuh. */
@Composable
fun Modifier.pressable(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.97f else 1f, label = "press")
    return this.graphicsLayer { scaleX = s; scaleY = s }.clickable(interactionSource = src, indication = null, enabled = enabled, onClick = onClick)
}

@Composable
fun QuickAction(icon: ImageVector, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(White).border(1.dp, Border, RoundedCornerShape(16.dp))
        .pressable(onClick = onClick).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(BrandSoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Brand, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Ink, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

fun statusInfo(s: String): Triple<String, Color, Color> = when (s.lowercase()) {
    "paid", "success", "completed", "done" -> Triple("Berhasil", Success, SuccessSoft)
    "pending", "waiting", "processing" -> Triple("Diproses", Warning, WarningSoft)
    "failed", "cancelled", "canceled", "expired", "refunded" -> Triple(if (s == "refunded") "Refund" else "Gagal", Danger, DangerSoft)
    else -> Triple(s.replaceFirstChar { it.uppercase() }, Muted, Field)
}

@Composable
fun StatusBadge(s: String) {
    val (l, fg, bg) = statusInfo(s)
    Box(Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(l, color = fg, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

/** Cache di memori: pindah menu langsung tampil, update berjalan di belakang. */
object AppCache {
    var products by mutableStateOf<List<Product>?>(null)
    var orders by mutableStateOf<List<Order>?>(null)
    var topup by mutableStateOf<TopupInfo?>(null)
    suspend fun refreshProducts() { runCatching { Api.products() }.onSuccess { products = it } }
    suspend fun refreshOrders() { runCatching { Api.orders() }.onSuccess { orders = it.first } }
    suspend fun refreshTopup() { runCatching { Api.topupInfo() }.onSuccess { topup = it } }
    suspend fun prefetch() = kotlinx.coroutines.coroutineScope {
        launch { refreshProducts() }; launch { refreshOrders() }; launch { refreshTopup() }
    }
    fun clear() { products = null; orders = null; topup = null }
}

/** Logo asli brand berdasarkan nama produk. */
private val BRAND_DOMAINS = listOf(
    "netflix" to "netflix.com", "spotify" to "spotify.com", "youtube" to "youtube.com", "yt " to "youtube.com",
    "canva" to "canva.com", "chatgpt" to "openai.com", "openai" to "openai.com", "gpt" to "openai.com",
    "capcut" to "capcut.com", "disney" to "disneyplus.com", "hotstar" to "disneyplus.com", "vidio" to "vidio.com",
    "viu" to "viu.com", "wetv" to "wetv.vip", "iqiyi" to "iq.com", "prime" to "primevideo.com", "amazon" to "amazon.com",
    "gemini" to "gemini.google.com", "claude" to "claude.ai", "perplexity" to "perplexity.ai", "grok" to "x.ai",
    "copilot" to "copilot.microsoft.com", "microsoft" to "microsoft.com", "office" to "office.com", "zoom" to "zoom.us",
    "grammarly" to "grammarly.com", "duolingo" to "duolingo.com", "picsart" to "picsart.com", "alight" to "alightmotion.com",
    "apple" to "apple.com", "icloud" to "icloud.com", "instagram" to "instagram.com", "tiktok" to "tiktok.com",
    "facebook" to "facebook.com", "telegram" to "telegram.org", "whatsapp" to "whatsapp.com", "discord" to "discord.com",
    "gmail" to "gmail.com", "google" to "google.com", "vpn" to "nordvpn.com", "express" to "expressvpn.com",
    "hbo" to "max.com", "mola" to "mola.tv", "genflix" to "genflix.co.id", "scribd" to "scribd.com", "linkedin" to "linkedin.com",
    "adobe" to "adobe.com", "figma" to "figma.com", "notion" to "notion.so", "steam" to "steampowered.com",
)
fun brandLogo(p: Product): String? {
    val t = (p.title + " " + p.loginType).lowercase() + " "
    val d = BRAND_DOMAINS.firstOrNull { t.contains(it.first) }?.second ?: return null
    return "https://www.google.com/s2/favicons?domain=$d&sz=128"
}

@Composable
fun ProductLogo(p: Product, size: Int = 44) {
    val logo = brandLogo(p)
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 3).dp)).background(if (logo != null) White else BrandSoft)
        .border(1.dp, Border, RoundedCornerShape((size / 3).dp)), contentAlignment = Alignment.Center) {
        if (logo != null) AsyncImage(model = logo, contentDescription = p.title, modifier = Modifier.size((size * 0.62f).dp).clip(RoundedCornerShape(6.dp)))
        else Icon(Icons.Filled.ShoppingBag, null, tint = Brand, modifier = Modifier.size((size / 2).dp))
    }
}

/** Foto profil: foto Google / upload sendiri / huruf awal. */
@Composable
fun UserAvatar(user: User, size: Int, onDark: Boolean = false) {
    val a = user.avatar
    val bmp = remember(a) {
        if (a.startsWith("data:image")) runCatching {
            val bytes = Base64.decode(a.substringAfter(","), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull() else null
    }
    Box(Modifier.size(size.dp).clip(CircleShape).background(if (onDark) Color(0x33FFFFFF) else BrandSoft), contentAlignment = Alignment.Center) {
        when {
            bmp != null -> Image(bmp, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            a.startsWith("http") -> AsyncImage(model = a, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else -> Text((user.name.ifBlank { "P" }).take(1).uppercase(), color = if (onDark) White else BrandDark, fontWeight = FontWeight.Bold, fontSize = (size * 0.4f).sp)
        }
    }
}

enum class Tab(val label: String, val icon: ImageVector) {
    Home("Beranda", Icons.Filled.Storefront), Orders("Pesanan", Icons.Filled.ReceiptLong),
    Topup("Top Up", Icons.Filled.AccountBalanceWallet), Help("Bantuan", Icons.Filled.SupportAgent), Profile("Profil", Icons.Filled.Person)
}

fun openWeb(ctx: Context, path: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Api.BASE + path)))

@Composable
fun App(googleToken: String?, onTokenConsumed: () -> Unit) {
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("cache", Context.MODE_PRIVATE) }
    val cached = remember { prefs.getString("user", null)?.let { runCatching { User.from(JSONObject(it)) }.getOrNull() } }
    var booting by remember { mutableStateOf(cached == null) }
    var user by remember { mutableStateOf(cached) }
    LaunchedEffect(Unit) {
        // Tampilkan data tersimpan langsung, lalu sinkron diam-diam di belakang.
        val r = runCatching { Api.me() }
        r.onSuccess { user = it }
        booting = false
        AppCache.prefetch()
    }
    LaunchedEffect(user) {
        val u = user
        if (u == null) { prefs.edit().remove("user").apply(); AppCache.clear() }
        else prefs.edit().putString("user", u.toJson().toString()).apply()
    }
    when {
        booting -> Splash()
        user == null -> LoginScreen(googleToken, onTokenConsumed) { user = it }
        else -> MainShell(user!!, onUser = { user = it }, onLogout = { user = null })
    }
}

@Composable
fun Splash() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(76.dp).clip(RoundedCornerShape(20.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF5B8CFF), BrandDark))),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Storefront, null, tint = White, modifier = Modifier.size(38.dp)) }
        Spacer(Modifier.height(18.dp))
        Text("Akun Instan", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(4.dp))
        Text("Belanja akun digital serba instan", color = Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(24.dp))
        CircularProgressIndicator(color = Brand, strokeWidth = 3.dp)
    }
}

// Kolom teks rounded yang dipakai di seluruh aplikasi
@Composable
fun SmoothField(
    value: String, onValueChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier,
    singleLine: Boolean = true, leading: (@Composable () -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, visualTransformation: androidx.compose.ui.text.input.VisualTransformation =
        androidx.compose.ui.text.input.VisualTransformation.None,
) {
    OutlinedTextField(
        value, onValueChange, modifier = modifier,
        shape = FieldShape, singleLine = singleLine, leadingIcon = leading,
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
fun LoginScreen(googleToken: String?, onTokenConsumed: () -> Unit, onLogin: (User) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var googleLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    // Token Google pulang dari browser mini lewat deep link
    LaunchedEffect(googleToken) {
        if (googleToken.isNullOrBlank()) return@LaunchedEffect
        googleLoading = true; error = ""
        runCatching { Api.loginGoogle(googleToken) }
            .onSuccess(onLogin)
            .onFailure { error = it.message ?: "Login Google gagal" }
        googleLoading = false
        onTokenConsumed()
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp).systemBarsPadding().imePadding(),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(64.dp).clip(RoundedCornerShape(20.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF5B8CFF), BrandDark))),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Storefront, null, tint = White, modifier = Modifier.size(32.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Selamat datang", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Ink)
        Text("Masuk untuk belanja akun, top up saldo, dan cek pesanan.", color = Muted)
        Spacer(Modifier.height(28.dp))

        // Login Google lewat browser mini (Custom Tab)
        OutlinedButton(
            enabled = !loading && !googleLoading,
            modifier = Modifier.fillMaxWidth().height(54.dp), shape = FieldShape,
            border = BorderStroke(1.dp, Border),
            colors = ButtonDefaults.outlinedButtonColors(containerColor = White, contentColor = Ink),
            onClick = {
                CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(Api.BASE + "/android-auth.html"))
            },
        ) {
            if (googleLoading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Brand)
            else {
                Text("G", color = Brand, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                Spacer(Modifier.width(10.dp))
                Text("Lanjutkan dengan Google", fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(20.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f), color = Border)
            Text("  atau pakai email  ", color = Muted, style = MaterialTheme.typography.bodySmall)
            HorizontalDivider(Modifier.weight(1f), color = Border)
        }
        Spacer(Modifier.height(20.dp))

        SmoothField(email, { email = it.trim() }, "Email", Modifier.fillMaxWidth(),
            leading = { Icon(Icons.Filled.Email, null, tint = Muted, modifier = Modifier.size(20.dp)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        Spacer(Modifier.height(14.dp))
        SmoothField(pass, { pass = it }, "Password", Modifier.fillMaxWidth(),
            leading = { Icon(Icons.Filled.Lock, null, tint = Muted, modifier = Modifier.size(20.dp)) },
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (error.isNotBlank()) { Spacer(Modifier.height(10.dp)); Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.height(22.dp))
        Button(
            enabled = !loading && !googleLoading && email.isNotBlank() && pass.isNotBlank(),
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
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<Product?>(null) }
    var legal by remember { mutableStateOf<String?>(null) }
    var sub by remember { mutableStateOf<String?>(null) }
    BackHandler(sub != null || legal != null || detail != null || tab != Tab.Home) {
        when {
            sub != null -> sub = null
            legal != null -> legal = null
            detail != null -> detail = null
            else -> tab = Tab.Home
        }
    }
    Scaffold(
        containerColor = Bg,
        bottomBar = {
            if (detail == null && legal == null && sub == null) Column {
              HorizontalDivider(color = Border)
              NavigationBar(containerColor = White, tonalElevation = 0.dp) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Brand, selectedTextColor = Brand,
                            unselectedIconColor = Muted, unselectedTextColor = Muted,
                            indicatorColor = BrandSoft,
                        ),
                        icon = { Icon(t.icon, null) }, label = { Text(t.label, maxLines = 1, style = MaterialTheme.typography.labelSmall) },
                    )
                }
              }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad)) {
            val legalKind = legal
            val product = detail
            when {
                sub == "edit" -> EditProfileScreen(user, onBack = { sub = null }) { onUser(it); sub = null }
                sub == "password" -> ChangePasswordScreen(onBack = { sub = null })
                legalKind != null -> LegalScreen(legalKind, onBack = { legal = null }, onSwitch = { legal = it })
                product != null -> ProductDetail(product, user, onBack = { detail = null }) { newBalance ->
                    onUser(user.copy(balance = newBalance)); detail = null; tab = Tab.Orders
                    scope.launch { AppCache.refreshOrders(); AppCache.refreshProducts() }
                }
                else -> when (tab) {
                    Tab.Home -> HomeScreen(user, onTopup = { tab = Tab.Topup }, onOrders = { tab = Tab.Orders }, onHelp = { tab = Tab.Help }, onProfile = { tab = Tab.Profile }) { detail = it }
                    Tab.Orders -> OrdersScreen(onExplore = { tab = Tab.Home })
                    Tab.Topup -> TopupScreen { onUser(user.copy(balance = it)) }
                    Tab.Help -> ChatScreen()
                    Tab.Profile -> ProfileScreen(
                        user,
                        onOpenHelp = { tab = Tab.Help },
                        onOpenLegal = { legal = it },
                        onLogout = onLogout,
                        onEdit = { sub = "edit" },
                        onPassword = { sub = "password" },
                    )
                }
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
fun SectionTitle(text: String, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Ink)
        trailing?.invoke()
    }
}

// ═══════════════ BERANDA ═══════════════

@Composable
fun HomeScreen(user: User, onTopup: () -> Unit, onOrders: () -> Unit = {}, onHelp: () -> Unit = {}, onProfile: () -> Unit = {}, open: (Product) -> Unit) {
    val products = AppCache.products
    var error by remember { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) { error = ""; runCatching { Api.products() }.onSuccess { AppCache.products = it }.onFailure { error = it.message ?: "Gagal memuat" } }
    Column(Modifier.fillMaxSize()) {
        // Sapaan + avatar
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            UserAvatar(user, 46)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Halo, ${user.name.ifBlank { "Pelanggan" }}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Mau beli akun apa hari ini?", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        // Kartu saldo dengan dekorasi lingkaran
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 96.dp).clip(CardShape)
            .background(Brush.linearGradient(listOf(Navy, Navy2)))) {
            Box(Modifier.size(140.dp).align(Alignment.TopEnd).offset(x = 40.dp, y = (-50).dp).clip(CircleShape).background(Color(0x1AFFFFFF)))
            Box(Modifier.size(90.dp).align(Alignment.BottomStart).offset(x = (-30).dp, y = 30.dp).clip(CircleShape).background(Color(0x14FFFFFF)))
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Saldo kamu", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.labelMedium)
                    Text(rupiah(user.balance), color = White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = onTopup, shape = ChipShape,
                    colors = ButtonDefaults.buttonColors(containerColor = White, contentColor = BrandDark),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Top Up", fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            QuickAction(Icons.Filled.AccountBalanceWallet, "Top Up", Modifier.weight(1f), onTopup)
            QuickAction(Icons.Filled.ReceiptLong, "Riwayat", Modifier.weight(1f), onOrders)
            QuickAction(Icons.Filled.SupportAgent, "Bantuan", Modifier.weight(1f), onHelp)
            QuickAction(Icons.Filled.Person, "Profil", Modifier.weight(1f), onProfile)
        }
        Spacer(Modifier.height(14.dp))
        // Pencarian
        OutlinedTextField(
            query, { query = it }, placeholder = { Text("Cari produk...") }, leadingIcon = { Icon(Icons.Filled.Search, null, tint = Muted) },
            singleLine = true, shape = FieldShape,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = White, unfocusedContainerColor = White,
                focusedBorderColor = Brand, unfocusedBorderColor = Border, cursorColor = Brand,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(14.dp))
        val list = products
        when {
            error.isNotBlank() && list == null -> ErrorBox(error) { reload++ }
            list == null -> Loading()
            else -> {
                val shown = list.filter { query.isBlank() || it.title.contains(query, true) || it.loginType.contains(query, true) }
                    .sortedBy { it.soldOut }
                LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item {
                        SectionTitle("Katalog produk") {
                            Box(Modifier.clip(RoundedCornerShape(8.dp)).background(BrandSoft).padding(horizontal = 8.dp, vertical = 3.dp)) {
                                Text("${shown.size} produk", color = BrandDark, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    val top = list.filter { !it.soldOut && it.soldCount > 0 }.sortedByDescending { it.soldCount }.take(6)
                    if (query.isBlank() && top.size >= 2) {
                        item { SectionTitle("Terlaris") }
                        item {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                top.forEach { p ->
                                    Column(Modifier.width(150.dp).clip(CardShape).background(White).border(1.dp, Border, CardShape).pressable { open(p) }.padding(14.dp)) {
                                        ProductLogo(p, 40)
                                        Spacer(Modifier.height(10.dp))
                                        Text(p.title, color = Ink, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.heightIn(min = 40.dp))
                                        Text(rupiah(p.price), color = Brand, fontWeight = FontWeight.Bold)
                                        Text("${p.soldCount} terjual", color = Muted, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                    if (shown.isEmpty()) item { Text("Produk tidak ditemukan", color = Muted, modifier = Modifier.padding(top = 8.dp)) }
                    items(shown, key = { it.id }) { p -> ProductCard(p) { if (!p.soldOut) open(p) } }
                    item { Spacer(Modifier.height(8.dp)) }
                }
            }
        }
    }
}

@Composable
fun ProductCard(p: Product, onClick: () -> Unit) {
    ElevatedCard(
        Modifier.fillMaxWidth().pressable(onClick = onClick),
        shape = CardShape,
        colors = CardDefaults.elevatedCardColors(containerColor = White),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.5.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProductLogo(p)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.title, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (p.loginType.isNotBlank()) Text(p.loginType, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp))
                        .background(if (p.soldOut) DangerSoft else SuccessSoft)
                        .border(1.dp, if (p.soldOut) Color(0xFFFECACA) else Color(0xFFBBF7D0), RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                ) {
                    Text(if (p.soldOut) "Habis" else "Tersedia", color = if (p.soldOut) Danger else Success, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                }
            }
            if (p.description.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(p.description, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = Border)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Mulai dari", color = Muted, style = MaterialTheme.typography.labelSmall)
                    Text(rupiah(p.price), color = Brand, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                }
                if (p.ratingAvg > 0) {
                    Icon(Icons.Filled.Star, null, tint = Color(0xFFF59E0B), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(3.dp))
                    Text(String.format("%.1f", p.ratingAvg), color = Ink, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(10.dp))
                }
                Text("Stok ${p.stock} · Terjual ${p.soldCount}", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

// ═══════════════ DETAIL PRODUK ═══════════════

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
                Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp)) {
                    Text("Deskripsi", fontWeight = FontWeight.SemiBold, color = Ink, style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(6.dp))
                    Text(p.description, color = Muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
            item { SectionTitle("Pilih akun (${picked.size} dipilih)") }
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
            if (error.isNotBlank()) { Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall); Spacer(Modifier.height(6.dp)) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Total ${rupiah(total)}", fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
                    Text("Saldo ${rupiah(user.balance)}", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    enabled = picked.isNotEmpty() && !busy, onClick = { confirm = true }, shape = FieldShape,
                    modifier = Modifier.height(50.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                ) { Text(if (busy) "Memproses..." else "Beli ${picked.size} akun", fontWeight = FontWeight.SemiBold) }
            }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, containerColor = White, shape = CardShape,
        title = { Text("Konfirmasi pembelian", fontWeight = FontWeight.Bold, color = Ink) },
        text = { Text("Beli ${picked.size} akun seharga ${rupiah(total)}? Saldo akan dipotong.", color = Muted) },
        confirmButton = { TextButton({
            confirm = false; busy = true; error = ""
            scope.launch {
                runCatching { Api.checkout(p.id, picked.toList()) }.onSuccess(onBought).onFailure { error = it.message ?: "Gagal" }
                busy = false
            }
        }) { Text("Beli sekarang", color = Brand, fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton({ confirm = false }) { Text("Batal", color = Muted) } })
}

// ═══════════════ PESANAN ═══════════════

@Composable
fun OrdersScreen(onExplore: () -> Unit = {}) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val orders = AppCache.orders
    var error by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("all") }
    val revealed = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(reload) { error = ""; runCatching { Api.orders() }.onSuccess { AppCache.orders = it.first }.onFailure { error = it.message ?: "Gagal memuat" } }
    Column(Modifier.fillMaxSize()) {
        Header("Pesanan", "Riwayat transaksi dan detail akun")
        val list = orders
        when {
            error.isNotBlank() && list == null -> ErrorBox(error) { reload++ }
            list == null -> Loading()
            list.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(72.dp).clip(CircleShape).background(BrandSoft), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.ReceiptLong, null, tint = Brand, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.height(14.dp))
                Text("Belum ada pesanan", color = Ink, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text("Akun yang kamu beli akan muncul di sini.", color = Muted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(16.dp))
                Button(onExplore, shape = FieldShape, colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White)) { Text("Lihat produk", fontWeight = FontWeight.SemiBold) }
            }
            else -> {
                val statuses = list.map { it.status.lowercase() }.distinct()
                val shown = if (filter == "all") list else list.filter { it.status.lowercase() == filter }
                LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (statuses.size > 1) item {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            (listOf("all") + statuses).forEach { s ->
                                val on = filter == s
                                Box(Modifier.clip(RoundedCornerShape(50)).background(if (on) Navy else White).border(1.dp, if (on) Navy else Border, RoundedCornerShape(50))
                                    .pressable { filter = s }.padding(horizontal = 14.dp, vertical = 7.dp)) {
                                    Text(if (s == "all") "Semua" else statusInfo(s).first, color = if (on) White else Ink, style = MaterialTheme.typography.labelLarge)
                                }
                            }
                        }
                    }
                    items(shown, key = { it.id }) { o ->
                        Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(o.titles.joinToString(", "), fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text("#${o.id.takeLast(8).uppercase()} · ${o.createdAt}", color = Muted, style = MaterialTheme.typography.labelSmall)
                                }
                                Spacer(Modifier.width(8.dp))
                                StatusBadge(o.status)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Total", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                Text(rupiah(o.total), color = Ink, fontWeight = FontWeight.Bold)
                            }
                            o.accounts.forEach { a ->
                                val key = "${o.id}:${a.itemIndex}:${a.accountIndex}"
                                val pw = revealed[key]
                                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = Border)
                                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Field).padding(horizontal = 12.dp, vertical = 8.dp)) {
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
}

@Composable
fun CopyRow(label: String, value: String, ctx: Context) = Row(verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) { Text(label, color = Muted, style = MaterialTheme.typography.labelSmall); Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Ink) }
    IconButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, value)) }) {
        Icon(Icons.Filled.ContentCopy, "Salin", tint = Brand, modifier = Modifier.size(18.dp))
    }
}

// ═══════════════ TOP UP ═══════════════


private val TOPUP_PRESETS = listOf(10000, 20000, 50000, 100000, 200000, 500000)
private val EWALLETS = listOf("DANA", "OVO", "GoPay", "ShopeePay", "LinkAja", "M-Banking")

@Composable
fun TopupScreen(onBalance: (Int) -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val info = AppCache.topup
    var amount by rememberSaveable { mutableStateOf("") }
    var payment by remember { mutableStateOf<Payment?>(null) }
    var status by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        info?.let { onBalance(it.balance) }
        runCatching { Api.topupInfo() }.onSuccess { AppCache.topup = it; onBalance(it.balance) }.onFailure { if (info == null) error = it.message ?: "" }
    }
    val pay = payment
    LaunchedEffect(pay?.refId) {
        if (pay == null) return@LaunchedEffect
        while (status != "paid" && status != "expired") {
            delay(4000)
            runCatching { Api.topupStatus(pay.refId) }.onSuccess { (s, bal) ->
                status = s
                if (s == "paid") { onBalance(bal); AppCache.topup = AppCache.topup?.copy(balance = bal) }
            }
        }
    }
    val min = info?.minTopup ?: 10000
    val value = amount.toIntOrNull() ?: 0
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Header("Top Up", "Isi saldo instan via QRIS")
            Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Kartu saldo
                Box(Modifier.fillMaxWidth().clip(CardShape).background(Brush.linearGradient(listOf(Navy, Navy2)))) {
                    Box(Modifier.size(160.dp).align(Alignment.TopEnd).offset(x = 50.dp, y = (-60).dp).clip(CircleShape).background(Color(0x1AFFFFFF)))
                    Box(Modifier.size(100.dp).align(Alignment.BottomStart).offset(x = (-30).dp, y = 40.dp).clip(CircleShape).background(Color(0x14FFFFFF)))
                    Column(Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(Color(0x33FFFFFF)), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.AccountBalanceWallet, null, tint = White, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                            Text("Saldo Akun Instan", color = Color(0xDDFFFFFF), style = MaterialTheme.typography.labelLarge)
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(if (info != null) rupiah(info.balance) else "Rp•••", color = White, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                        if ((info?.pendingCount ?: 0) > 0) {
                            Spacer(Modifier.height(6.dp))
                            Text("${info!!.pendingCount} pembayaran menunggu", color = Color(0xDDFFFFFF), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }

                if (pay == null) {
                    // Nominal besar
                    Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(18.dp)) {
                        Text("Masukkan nominal", color = Muted, style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Rp", color = Ink, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(8.dp))
                            androidx.compose.foundation.text.BasicTextField(
                                value = if (value > 0) java.text.NumberFormat.getInstance(java.util.Locale("in", "ID")).format(value) else "",
                                onValueChange = { amount = it.filter(Char::isDigit).take(9).trimStart('0') },
                                textStyle = androidx.compose.ui.text.TextStyle(color = Ink, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(Brand),
                                modifier = Modifier.weight(1f),
                                decorationBox = { inner -> Box { if (value == 0) Text("0", color = Color(0xFFCBD5E1), fontSize = 30.sp, fontWeight = FontWeight.ExtraBold); inner() } },
                            )
                        }
                        HorizontalDivider(color = Border, modifier = Modifier.padding(vertical = 10.dp))
                        Text("Minimal ${rupiah(min)}", color = if (value in 1 until min) Danger else Muted, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(14.dp))
                        TOPUP_PRESETS.chunked(3).forEach { row ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                row.forEach { preset ->
                                    val on = value == preset
                                    Column(
                                        Modifier.weight(1f).clip(FieldShape)
                                            .background(if (on) BrandSoft else Field)
                                            .border(if (on) 1.5.dp else 1.dp, if (on) Brand else Border, FieldShape)
                                            .clickable { amount = preset.toString() }
                                            .padding(vertical = 14.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                    ) {
                                        Text(rupiah(preset), color = if (on) BrandDark else Ink, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                        if (preset >= 100000) Text("Populer", color = if (on) Brand else Muted, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                    // Metode pembayaran
                    Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(18.dp)) {
                        Text("Metode pembayaran", color = Ink, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(12.dp))
                        Row(Modifier.fillMaxWidth().clip(FieldShape).background(BrandSoft).border(1.5.dp, Brand, FieldShape).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(White), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.QrCode2, null, tint = Brand)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("QRIS", fontWeight = FontWeight.Bold, color = Ink)
                                Text("Otomatis masuk dalam hitungan detik", color = Muted, style = MaterialTheme.typography.bodySmall)
                            }
                            Icon(Icons.Filled.CheckCircle, null, tint = Brand)
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            EWALLETS.forEach {
                                Box(Modifier.clip(RoundedCornerShape(8.dp)).background(Field).padding(horizontal = 10.dp, vertical = 5.dp)) {
                                    Text(it, color = Muted, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                    if (error.isNotBlank()) Text(error, color = Danger, style = MaterialTheme.typography.bodySmall)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
                        Icon(Icons.Filled.Shield, null, tint = Success, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Pembayaran aman & terverifikasi otomatis", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(8.dp))
                } else {
                    // Halaman bayar
                    Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        val (label, fg, bg) = when (status) {
                            "paid" -> Triple("Berhasil", Success, SuccessSoft)
                            "expired" -> Triple("Kedaluwarsa", Danger, DangerSoft)
                            else -> Triple("Menunggu pembayaran", Warning, WarningSoft)
                        }
                        Box(Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 12.dp, vertical = 5.dp)) {
                            Text(label, color = fg, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Total bayar", color = Muted, style = MaterialTheme.typography.bodySmall)
                        Text(rupiah(pay.total), fontSize = 30.sp, color = Ink, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.height(16.dp))
                        if (status == "paid") {
                            Box(Modifier.size(120.dp).clip(CircleShape).background(SuccessSoft), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.CheckCircle, null, tint = Success, modifier = Modifier.size(64.dp))
                            }
                            Spacer(Modifier.height(12.dp))
                            Text("Saldo sudah bertambah 🎉", color = Ink, fontWeight = FontWeight.SemiBold)
                        } else {
                            Box(Modifier.size(260.dp).clip(RoundedCornerShape(20.dp)).background(White).border(1.dp, Border, RoundedCornerShape(20.dp)).padding(12.dp), contentAlignment = Alignment.Center) { QrImage(pay.qrImage) }
                            Spacer(Modifier.height(12.dp))
                            Text("Scan pakai e-wallet atau m-banking apa saja", color = Muted, style = MaterialTheme.typography.bodySmall)
                            if (pay.expired.isNotBlank()) Text("Berlaku sampai ${pay.expired}", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(14.dp))
                        HorizontalDivider(color = Border)
                        Spacer(Modifier.height(10.dp))
                        CopyRow("ID transaksi", pay.refId, ctx)
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
        // Tombol bawah menempel
        Column(Modifier.fillMaxWidth().background(White)) {
            HorizontalDivider(color = Border)
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                if (pay == null) {
                    Column(Modifier.weight(1f)) {
                        Text("Total", color = Muted, style = MaterialTheme.typography.labelSmall)
                        Text(rupiah(value), color = Ink, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    }
                    Button(
                        enabled = !busy && value >= min,
                        modifier = Modifier.height(52.dp), shape = FieldShape,
                        colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                        contentPadding = PaddingValues(horizontal = 28.dp),
                        onClick = {
                            busy = true; error = ""
                            scope.launch {
                                runCatching { Api.createTopup(value) }
                                    .onSuccess { payment = it; status = "pending" }
                                    .onFailure { error = it.message ?: "Gagal membuat QRIS" }
                                busy = false
                            }
                        },
                    ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = White) else Text("Bayar sekarang", fontWeight = FontWeight.SemiBold) }
                } else {
                    Button(
                        { payment = null; status = ""; amount = "" },
                        modifier = Modifier.fillMaxWidth().height(52.dp), shape = FieldShape,
                        colors = if (status == "paid") ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White)
                        else ButtonDefaults.buttonColors(containerColor = Field, contentColor = Ink),
                    ) { Text(if (status == "paid") "Selesai" else "Ganti nominal", fontWeight = FontWeight.SemiBold) }
                }
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

// ═══════════════ BANTUAN AI ═══════════════

@Composable
fun ChatScreen() {
    val scope = rememberCoroutineScope()
    val msgs = remember { mutableStateListOf(ChatMsg("assistant", "Halo! Saya asisten Akun Instan. Ada yang bisa dibantu soal pesanan, saldo, atau akun?")) }
    var input by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LaunchedEffect(msgs.size) { if (msgs.size > 0) listState.animateScrollToItem(msgs.size - 1) }
    Column(Modifier.fillMaxSize().imePadding()) {
        Header("Bantuan AI", "Tanya apa saja seputar Akun Instan")
        if (msgs.size == 1 && !busy) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Cara top up saldo", "Cek status pesanan", "Masalah pembayaran", "Bantuan akun").forEach { q ->
                    Box(Modifier.clip(RoundedCornerShape(50)).background(White).border(1.dp, Border, RoundedCornerShape(50)).pressable { input = q }.padding(horizontal = 14.dp, vertical = 8.dp)) {
                        Text(q, color = Ink, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
        LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(msgs) { m ->
                val mine = m.role == "user"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                    if (!mine) {
                        Box(Modifier.size(30.dp).clip(CircleShape).background(BrandSoft), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.SupportAgent, null, tint = Brand, modifier = Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        m.text,
                        Modifier.widthIn(max = 280.dp).clip(
                            if (mine) RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
                            else RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
                        ).background(if (mine) Brand else White).border(1.dp, if (mine) Brand else Border, RoundedCornerShape(16.dp)).padding(12.dp),
                        color = if (mine) White else Ink,
                    )
                }
            }
            if (busy) item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(30.dp).clip(CircleShape).background(BrandSoft), contentAlignment = Alignment.Center) { Icon(Icons.Filled.SupportAgent, null, tint = Brand, modifier = Modifier.size(16.dp)) }
                    Spacer(Modifier.width(6.dp))
                    Row(Modifier.clip(RoundedCornerShape(16.dp)).background(White).border(1.dp, Border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Brand)
                        Spacer(Modifier.width(8.dp))
                        Text("Asisten sedang mengetik", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
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

// ═══════════════ PROFIL ═══════════════

@Composable
fun ProfileRow(icon: ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(White)
            .border(1.dp, if (danger) Color(0xFFFECACA) else Border, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(if (danger) DangerSoft else BrandSoft), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (danger) Danger else Brand, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(label, Modifier.weight(1f), color = if (danger) Danger else Ink, fontWeight = if (danger) FontWeight.SemiBold else FontWeight.Medium)
        Icon(Icons.Filled.ChevronRight, null, tint = Muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun ProfileGroupLabel(text: String) =
    Text(text, color = Muted, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, top = 6.dp))

@Composable
fun ProfileScreen(
    user: User, onOpenHelp: () -> Unit, onOpenLegal: (String) -> Unit, onLogout: () -> Unit,
    onEdit: () -> Unit, onPassword: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Profil", "Kelola akun dan saldo kamu")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.fillMaxWidth().clip(CardShape).background(Brush.linearGradient(listOf(Navy, Navy2)))) {
                Box(Modifier.size(120.dp).align(Alignment.TopEnd).offset(x = 30.dp, y = (-40).dp).clip(CircleShape).background(Color(0x1AFFFFFF)))
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    UserAvatar(user, 60, onDark = true)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(user.name, color = White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(user.email, color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (user.phone.isNotBlank()) Text(user.phone, color = Color(0xCCFFFFFF), style = MaterialTheme.typography.bodySmall)
                        if (user.isGoogle) Text("Masuk dengan Google", color = Color(0xCCFFFFFF), style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onEdit) { Icon(Icons.Filled.Edit, "Edit profil", tint = White) }
                }
            }
            ElevatedCard(shape = CardShape, colors = CardDefaults.elevatedCardColors(containerColor = White), elevation = CardDefaults.elevatedCardElevation(defaultElevation = 0.5.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(BrandSoft), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.AccountBalanceWallet, null, tint = Brand, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Saldo", color = Muted, style = MaterialTheme.typography.labelSmall)
                        Text(rupiah(user.balance), fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            ProfileGroupLabel("Akun")
            ProfileRow(Icons.Filled.Person, "Edit profil") { onEdit() }
            if (!user.isGoogle) ProfileGroupLabel("Keamanan")
            if (!user.isGoogle) ProfileRow(Icons.Filled.Lock, "Ganti password") { onPassword() }
            ProfileGroupLabel("Bantuan")
            ProfileRow(Icons.Filled.SupportAgent, "Chat bantuan AI") { onOpenHelp() }
            ProfileGroupLabel("Legal")
            ProfileRow(Icons.Filled.Description, "Syarat & Ketentuan") { onOpenLegal("terms") }
            ProfileRow(Icons.Filled.Shield, "Kebijakan Privasi") { onOpenLegal("privacy") }
            ProfileRow(Icons.Filled.CurrencyExchange, "Kebijakan Refund") { onOpenLegal("refund") }
            ProfileRow(Icons.Filled.Info, "Disclaimer") { onOpenLegal("disclaimer") }
            Spacer(Modifier.height(4.dp))
            ProfileRow(Icons.Filled.Logout, "Keluar", danger = true) { scope.launch { Api.logout(); onLogout() } }
            Text("Versi ${BuildConfig.VERSION_NAME}", color = Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp, start = 4.dp))
        }
    }
}

/** Ubah foto dari galeri jadi JPEG kecil (data URL) supaya ringan dikirim. */
fun imageToDataUrl(ctx: Context, uri: Uri): String? = runCatching {
    val src = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it) }
    val side = minOf(src.width, src.height)
    val square = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
    val small = Bitmap.createScaledBitmap(square, 320, 320, true)
    val out = ByteArrayOutputStream()
    small.compress(Bitmap.CompressFormat.JPEG, 82, out)
    "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}.getOrNull()

@Composable
fun EditProfileScreen(user: User, onBack: () -> Unit, onSaved: (User) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(user.name) }
    var phone by remember { mutableStateOf(user.phone) }
    var avatar by remember { mutableStateOf<String?>(null) } // null = tidak diubah
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) imageToDataUrl(ctx, uri)?.let { avatar = it } ?: run { error = "Foto tidak bisa dibaca" }
    }
    val preview = user.copy(name = name, avatar = avatar ?: user.avatar)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Edit profil", "Foto, nama, dan nomor WhatsApp", onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box {
                    UserAvatar(preview, 96)
                    Box(Modifier.align(Alignment.BottomEnd).size(32.dp).clip(CircleShape).background(Brand).clickable { picker.launch("image/*") }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.PhotoCamera, "Ganti foto", tint = White, modifier = Modifier.size(16.dp))
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ picker.launch("image/*") }) { Text("Ganti foto", color = Brand, fontWeight = FontWeight.SemiBold) }
                    if (preview.avatar.isNotBlank()) TextButton({ avatar = "" }) { Text("Hapus foto", color = Danger) }
                }
                if (user.isGoogle) Text("Foto dari akun Google dipakai otomatis", color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SmoothField(name, { name = it.take(80) }, "Nama lengkap", Modifier.fillMaxWidth(), leading = { Icon(Icons.Filled.Person, null, tint = Muted) })
                SmoothField(phone, { phone = it.filter { c -> c.isDigit() || c in "+-() " }.take(25) }, "No. WhatsApp", Modifier.fillMaxWidth(),
                    leading = { Icon(Icons.Filled.Phone, null, tint = Muted) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                SmoothField(user.email, {}, "Email (tidak bisa diubah)", Modifier.fillMaxWidth(), leading = { Icon(Icons.Filled.Email, null, tint = Muted) })
            }
            if (error.isNotBlank()) Text(error, color = Danger, style = MaterialTheme.typography.bodySmall)
            Button(
                enabled = !busy && name.trim().length >= 2,
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = FieldShape,
                colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                onClick = {
                    busy = true; error = ""
                    scope.launch {
                        runCatching { Api.updateProfile(name.trim(), phone.trim(), avatar) }
                            .onSuccess { onSaved(it.copy(balance = user.balance)) }
                            .onFailure { error = it.message ?: "Gagal menyimpan" }
                        busy = false
                    }
                },
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = White) else Text("Simpan perubahan", fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
fun ChangePasswordScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var done by remember { mutableStateOf("") }
    val pw = PasswordVisualTransformation()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Ganti password", "Minimal 6 karakter", onBack)
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SmoothField(current, { current = it }, "Password saat ini", Modifier.fillMaxWidth(), leading = { Icon(Icons.Filled.Lock, null, tint = Muted) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = pw)
                SmoothField(next, { next = it }, "Password baru", Modifier.fillMaxWidth(), leading = { Icon(Icons.Filled.Key, null, tint = Muted) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = pw)
                SmoothField(confirm, { confirm = it }, "Ulangi password baru", Modifier.fillMaxWidth(), leading = { Icon(Icons.Filled.Key, null, tint = Muted) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = pw)
            }
            if (confirm.isNotEmpty() && confirm != next) Text("Password baru tidak sama", color = Danger, style = MaterialTheme.typography.bodySmall)
            if (error.isNotBlank()) Text(error, color = Danger, style = MaterialTheme.typography.bodySmall)
            if (done.isNotBlank()) Text(done, color = Success, fontWeight = FontWeight.SemiBold)
            Button(
                enabled = !busy && current.isNotBlank() && next.length >= 6 && next == confirm,
                modifier = Modifier.fillMaxWidth().height(52.dp), shape = FieldShape,
                colors = ButtonDefaults.buttonColors(containerColor = Brand, contentColor = White),
                onClick = {
                    busy = true; error = ""; done = ""
                    scope.launch {
                        runCatching { Api.changePassword(current, next) }
                            .onSuccess { done = it; current = ""; next = ""; confirm = "" }
                            .onFailure { error = it.message ?: "Gagal mengganti password" }
                        busy = false
                    }
                },
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = White) else Text("Simpan password", fontWeight = FontWeight.SemiBold) }
        }
    }
}

// ═══════════════ HALAMAN LEGAL (teks asli dari website) ═══════════════

data class LegalDoc(val title: String, val intro: String, val sections: List<Pair<String, List<String>>>)

private val LEGAL_DOCS = mapOf(
    "terms" to LegalDoc(
        "Syarat & Ketentuan",
        "Dengan mendaftar dan bertransaksi di Akun Instan, kamu dianggap sudah membaca dan menyetujui ketentuan di bawah ini.",
        listOf(
            "1. Ketentuan akun pembeli" to listOf(
                "Satu orang hanya boleh memakai satu akun Akun Instan. Data yang didaftarkan wajib benar dan aktif, terutama email dan nomor WhatsApp.",
                "Keamanan password akun Akun Instan sepenuhnya tanggung jawab pemilik akun. Segala aktivitas yang terjadi setelah login dianggap dilakukan oleh pemilik akun.",
                "Akun Instan berhak menangguhkan atau memblokir akun yang terindikasi melakukan penipuan, chargeback, spam pembelian, atau menyalahgunakan sistem saldo.",
            ),
            "2. Saldo dan pembayaran" to listOf(
                "Seluruh pembelian di Akun Instan memakai saldo. Saldo diisi lewat menu Top Up dan baru masuk setelah admin memverifikasi bukti pembayaran.",
                "Permintaan top up diproses pada jam operasional. Nominal yang masuk mengikuti jumlah yang benar-benar diterima admin.",
                "Saldo yang sudah masuk tidak dapat dicairkan kembali menjadi uang tunai dan hanya bisa dipakai untuk transaksi di Akun Instan.",
            ),
            "3. Produk akun digital" to listOf(
                "Produk yang dijual adalah akun digital dengan stok terbatas. Stok yang ditampilkan adalah stok nyata dari database, bukan contoh.",
                "Detail login (email dan password) hanya terbuka setelah pembayaran berhasil dan dapat dilihat kapan saja di halaman Pesanan.",
                "Pembeli wajib segera mengganti password akun yang dibeli setelah menerima detail login.",
            ),
            "4. Larangan" to listOf(
                "Dilarang menjual ulang akun dengan klaim garansi atas nama Akun Instan tanpa izin tertulis.",
                "Dilarang memakai akun yang dibeli untuk aktivitas ilegal, penipuan, atau tindakan yang melanggar ketentuan penyedia layanan asal.",
            ),
            "5. Perubahan ketentuan" to listOf(
                "Akun Instan dapat memperbarui syarat dan ketentuan ini sewaktu-waktu. Versi terbaru yang tayang di halaman ini adalah versi yang berlaku.",
            ),
        ),
    ),
    "privacy" to LegalDoc(
        "Kebijakan Privasi",
        "Kami hanya mengumpulkan data yang benar-benar dibutuhkan untuk menjalankan transaksi dan menjaga keamanan akun kamu.",
        listOf(
            "1. Data yang kami kumpulkan" to listOf(
                "Data akun: nama, email, dan nomor WhatsApp (opsional) yang kamu isi saat mendaftar.",
                "Data transaksi: riwayat top up, riwayat pesanan, nominal, metode pembayaran, dan catatan yang kamu kirim ke admin.",
                "Data teknis dasar yang diperlukan agar sesi login tetap aman.",
            ),
            "2. Cara kami memakai data" to listOf(
                "Memproses pembelian, verifikasi top up, dan pengiriman detail akun.",
                "Mengirim notifikasi terkait status pesanan dan saldo di dalam aplikasi.",
                "Mendeteksi penyalahgunaan, penipuan, dan aktivitas mencurigakan.",
            ),
            "3. Keamanan data" to listOf(
                "Password akun Akun Instan disimpan dalam bentuk hash, bukan teks biasa.",
                "Kredensial akun yang dijual disimpan dalam bentuk terenkripsi dan hanya terbuka untuk pembeli sah setelah pembayaran.",
                "Akses admin dilindungi sesi terpisah dan tidak dibagikan ke pihak ketiga.",
            ),
            "4. Berbagi data" to listOf(
                "Kami tidak menjual maupun menyewakan data pribadi kamu ke pihak mana pun.",
                "Data hanya dibagikan bila diwajibkan oleh hukum yang berlaku.",
            ),
            "5. Hak kamu" to listOf(
                "Kamu bisa meminta perubahan atau penghapusan data akun kapan saja lewat menu Bantuan atau kontak admin.",
                "Penghapusan akun akan menghapus riwayat top up dan pesanan yang terkait secara permanen.",
            ),
        ),
    ),
    "refund" to LegalDoc(
        "Kebijakan Refund",
        "Kami ingin transaksi berjalan adil untuk semua pihak. Berikut aturan pengembalian dana yang berlaku.",
        listOf(
            "1. Refund yang disetujui" to listOf(
                "Akun yang dibeli tidak bisa dipakai sama sekali sejak awal (salah kredensial) dan dilaporkan maksimal 1x24 jam setelah pembelian.",
                "Terjadi kesalahan sistem sehingga saldo terpotong tetapi detail akun tidak diterima.",
            ),
            "2. Refund yang ditolak" to listOf(
                "Password akun sudah diganti oleh pembeli lalu terjadi masalah setelahnya.",
                "Pembeli salah membeli produk karena tidak membaca deskripsi.",
                "Laporan dikirim lewat dari batas waktu klaim.",
            ),
            "3. Bentuk pengembalian" to listOf(
                "Refund yang disetujui dikembalikan dalam bentuk saldo Akun Instan, bukan uang tunai.",
                "Proses peninjauan maksimal 2x24 jam sejak laporan lengkap diterima admin.",
            ),
        ),
    ),
    "disclaimer" to LegalDoc(
        "Disclaimer",
        "Batasan tanggung jawab Akun Instan atas produk digital dan layanan yang dijual di platform ini.",
        listOf(
            "1. Status platform" to listOf(
                "Akun Instan adalah toko digital independen yang menjual akun dan lisensi layanan pihak ketiga. Kami tidak berafiliasi, tidak disponsori, dan tidak mewakili merek mana pun yang produknya tercantum di katalog.",
                "Seluruh nama merek, logo, dan tanda dagang adalah milik pemiliknya masing-masing dan hanya dipakai sebagai keterangan produk.",
            ),
            "2. Ketersediaan layanan" to listOf(
                "Stok, harga, dan masa aktif produk dapat berubah sewaktu-waktu mengikuti kebijakan penyedia layanan aslinya.",
                "Kami berusaha menjaga situs tetap online, namun tidak menjamin layanan bebas gangguan, pemeliharaan, atau kendala pada penyedia pihak ketiga.",
            ),
            "3. Tanggung jawab pengguna" to listOf(
                "Pembeli bertanggung jawab menjaga kerahasiaan detail akun yang diterima dan tidak membagikannya ke pihak lain.",
                "Penyalahgunaan akun, pelanggaran ketentuan penyedia layanan, atau perubahan kredensial oleh pembeli berada di luar tanggung jawab Akun Instan.",
            ),
            "4. Batasan ganti rugi" to listOf(
                "Tanggung jawab maksimum Akun Instan atas satu transaksi terbatas pada nilai saldo yang dibayarkan untuk transaksi tersebut.",
                "Kami tidak bertanggung jawab atas kerugian tidak langsung seperti kehilangan data, kehilangan pendapatan, atau gangguan pekerjaan.",
            ),
            "5. Konten informasi" to listOf(
                "Deskripsi produk, panduan, dan jawaban asisten di situs ini bersifat informatif dan dapat berubah tanpa pemberitahuan.",
                "Untuk keputusan penting, konfirmasikan terlebih dahulu ke admin lewat halaman Bantuan.",
            ),
        ),
    ),
)

private val LEGAL_TABS = listOf("terms" to "Syarat", "privacy" to "Privasi", "refund" to "Refund", "disclaimer" to "Disclaimer")

@Composable
fun LegalScreen(kind: String, onBack: () -> Unit, onSwitch: (String) -> Unit) {
    val doc = LEGAL_DOCS[kind] ?: LEGAL_DOCS.getValue("terms")
    Column(Modifier.fillMaxSize()) {
        Header(doc.title, "Dokumen resmi Akun Instan", onBack)
        // Tab antar dokumen legal
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LEGAL_TABS.forEach { (id, label) ->
                val on = id == kind
                Box(
                    Modifier.clip(ChipShape).background(if (on) Brand else White)
                        .border(1.dp, if (on) Brand else Border, ChipShape)
                        .clickable { onSwitch(id) }.padding(horizontal = 14.dp, vertical = 8.dp),
                ) { Text(label, color = if (on) White else Ink, style = MaterialTheme.typography.labelLarge, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal) }
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(Modifier.fillMaxWidth().clip(CardShape).background(BrandSoft).padding(16.dp)) {
                    Text(doc.intro, color = BrandDark, style = MaterialTheme.typography.bodyMedium)
                }
            }
            doc.sections.forEach { (heading, paragraphs) ->
                item(key = heading) {
                    Column(Modifier.fillMaxWidth().clip(CardShape).background(White).border(1.dp, Border, CardShape).padding(16.dp)) {
                        Text(heading, fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleSmall)
                        paragraphs.forEach { p ->
                            Spacer(Modifier.height(8.dp))
                            Row {
                                Text("•", color = Brand, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 8.dp))
                                Text(p, color = Muted, style = MaterialTheme.typography.bodyMedium, lineHeight = 20.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}
