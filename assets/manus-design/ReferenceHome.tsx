import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Upload,
  Clock3,
  CreditCard,
  Headphones,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";

type Variant = { name: string; price: number; stock: number; duration?: string };
export type Product = {
  id: number;
  name: string;
  category: string;
  description: string;
  image: string;
  bestSeller?: boolean;
  variants: Variant[];
};
type CartLine = { product: Product; variant: Variant; quantity: number };
type OrderStatus = "Menunggu pembayaran" | "Menunggu verifikasi" | "Diproses" | "Selesai";
type Order = { id: string; createdAt: string; total: number; items: CartLine[]; status: OrderStatus; proofName?: string; proofData?: string };

const products: Product[] = [
  {
    id: 1,
    name: "Canva Premium",
    category: "Design & Creative",
    description: "Template premium, elemen eksklusif, Background Remover, dan Magic Resize untuk membuat desain lebih cepat.",
    image: "https://cdn.phototourl.com/free/2026-08-19-ec85b45d-90da-4f51-b34f-123189de1a03.jpg",
    bestSeller: true,
    variants: [
      { name: "Member 1 Bulan", price: 2000, stock: 42 },
      { name: "Design 1 Bulan", price: 5000, stock: 28 },
      { name: "Design 6 Bulan", price: 15000, stock: 14 },
      { name: "Lifetime", price: 30000, stock: 9 },
    ],
  },
  {
    id: 2,
    name: "Alight Motion Premium",
    category: "Design & Creative",
    description: "Akses fitur premium, efek, preset, font, dan tools editing lengkap untuk konten yang lebih hidup.",
    image: "https://cdn.phototourl.com/free/2026-08-19-ee44d483-51e0-4d42-87c0-bc464338c3b0.jpg",
    bestSeller: true,
    variants: [
      { name: "1 Tahun Acc Seller", price: 3000, stock: 38 },
      { name: "1 Tahun Acc Buyer", price: 5000, stock: 26 },
      { name: "100 Akun", price: 20000, stock: 8 },
    ],
  },
  {
    id: 3,
    name: "CapCut Premium",
    category: "Design & Creative",
    description: "Editing video lebih lengkap dengan efek, filter, template, font, transisi, dan tools premium.",
    image: "https://cdn.phototourl.com/free/2026-08-19-0adf4068-054c-481c-8f5e-a1e40d6b59ae.jpg",
    variants: [
      { name: "Sharing 7 Hari", price: 5000, stock: 25 },
      { name: "Private 7 Hari", price: 9000, stock: 25 },
      { name: "Private 1 Bulan", price: 30000, stock: 11 },
    ],
  },
  {
    id: 4,
    name: "Gemini Pro",
    category: "AI & Productivity",
    description: "Bantu belajar, menulis, menganalisis, dan menyelesaikan pekerjaan dengan akses AI premium.",
    image: "https://upload.shizukuuu.cloud/get/vbqrjv.png",
    variants: [{ name: "Pro 18 Bulan", price: 20000, stock: 17 }],
  },
  {
    id: 47,
    name: "Pulsa All Provider",
    category: "Service",
    description: "Isi pulsa Telkomsel, Axis, XL, Smartfren, Indosat, By.U, dan Tri dalam satu tempat.",
    image: "https://dummyimage.com/800x600/12323c/9de8e8.png&text=PULSA+ALL+PROVIDER",
    variants: [
      { name: "Rp5.000", price: 5500, stock: 999 },
      { name: "Rp10.000", price: 10500, stock: 999 },
      { name: "Rp25.000", price: 25500, stock: 999 },
      { name: "Rp50.000", price: 50500, stock: 999 },
    ],
  },
  {
    id: 46,
    name: "E-Money All Provider",
    category: "Service",
    description: "Top up DANA, OVO, ShopeePay, GoPay, LinkAja, AstraPay, Maxim, SpeedCash, dan OCTO Pay.",
    image: "https://dummyimage.com/800x600/162d48/a7c8ff.png&text=E-MONEY+ALL+PROVIDER",
    variants: [
      { name: "Rp5.000", price: 5500, stock: 999 },
      { name: "Rp10.000", price: 10500, stock: 999 },
      { name: "Rp25.000", price: 25500, stock: 999 },
      { name: "Rp50.000", price: 50500, stock: 999 },
    ],
  },
];

const categories = ["Semua", "Design & Creative", "AI & Productivity", "Service"];
export const formatPrice = (value: number) => `Rp${value.toLocaleString("id-ID")}`;

export function filterCatalog(items: Product[], activeCategory: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((product) => {
    const categoryMatch = activeCategory === "Semua" || product.category === activeCategory;
    const text = `${product.name} ${product.category} ${product.description}`.toLowerCase();
    return categoryMatch && text.includes(normalizedQuery);
  });
}

function ProductArt({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <div className={`product-art ${className}`}>
      <img src={product.image} alt={product.name} loading="lazy" />
      <div className="product-art-shade" />
      <span className="product-art-category">{product.category}</span>
    </div>
  );
}

export default function Home() {
  const [activeCategory, setActiveCategory] = useState("Semua");
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginState, setLoginState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [loggedIn, setLoggedIn] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>(() => {
    try { return JSON.parse(localStorage.getItem("ryy_orders") || "[]") as Order[]; } catch { return []; }
  });
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [pendingProof, setPendingProof] = useState<{ name: string; data: string } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const filteredProducts = useMemo(() => filterCatalog(products, activeCategory, search), [activeCategory, search]);

  const cartCount = cart.reduce((total, line) => total + line.quantity, 0);
  const cartTotal = cart.reduce((total, line) => total + line.variant.price * line.quantity, 0);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  };

  const addToCart = (product: Product, variant: Variant) => {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id && line.variant.name === variant.name);
      if (existing) return current.map((line) => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { product, variant, quantity: 1 }];
    });
    showToast(`${product.name} ditambahkan ke keranjang`);
    setSelectedProduct(null);
  };

  const openProduct = (product: Product) => {
    setSelectedProduct(product);
    setSelectedVariant(product.variants[0]);
  };

  const updateQuantity = (line: CartLine, amount: number) => {
    setCart((current) => current.flatMap((item) => {
      if (item !== line) return [item];
      const quantity = item.quantity + amount;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  };

  const createOrder = () => {
    if (!cart.length) return;
    const order: Order = { id: `RYY-${Date.now().toString(36).toUpperCase()}`, createdAt: new Date().toISOString(), total: cartTotal, items: cart, status: "Menunggu pembayaran" };
    const next = [order, ...orders];
    setOrders(next);
    localStorage.setItem("ryy_orders", JSON.stringify(next));
    setActiveOrder(order);
    setCart([]);
    setCartOpen(false);
    setCheckoutOpen(true);
    showToast(`Order ${order.id} dibuat`);
  };

  const markPaymentSubmitted = () => {
    if (!activeOrder) return;
    const updated = { ...activeOrder, status: "Menunggu verifikasi" as OrderStatus };
    const next = orders.map((order) => order.id === updated.id ? updated : order);
    setOrders(next);
    localStorage.setItem("ryy_orders", JSON.stringify(next));
    setActiveOrder(updated);
    showToast("Pembayaran dikirim untuk diverifikasi");
  };

  const copyOrderId = async (id: string) => {
    try { await navigator.clipboard.writeText(id); showToast("ID order disalin"); } catch { showToast(id); }
  };

  const handleProofUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) { showToast("Gunakan gambar maksimal 4 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setPendingProof({ name: file.name, data: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const submitProof = () => {
    if (!activeOrder || !pendingProof) return;
    const updated = { ...activeOrder, proofName: pendingProof.name, proofData: pendingProof.data, status: "Menunggu verifikasi" as OrderStatus };
    const next = orders.map((order) => order.id === updated.id ? updated : order);
    setOrders(next); localStorage.setItem("ryy_orders", JSON.stringify(next)); setActiveOrder(updated); setPendingProof(null); showToast("Bukti pembayaran berhasil dikirim");
  };

  const reviewOrder = (order: Order, status: OrderStatus) => {
    const updated = { ...order, status };
    const next = orders.map((item) => item.id === order.id ? updated : item);
    setOrders(next); localStorage.setItem("ryy_orders", JSON.stringify(next));
    if (activeOrder?.id === order.id) setActiveOrder(updated);
    showToast(`${order.id} diubah menjadi ${status}`);
  };

  const submitLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginState("loading");
    window.setTimeout(() => {
      setLoggedIn(true);
      setLoginState("success");
      showToast("Login berhasil. Selamat datang kembali!");
      window.setTimeout(() => setLoginOpen(false), 650);
    }, 650);
  };

  return (
    <div className="store-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="site-header">
        <a href="#top" className="brand" aria-label="RYY STORE home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span><strong>RYY</strong> STORE</span>
        </a>
        <nav className={`main-nav ${mobileMenu ? "is-open" : ""}`}>
          <a href="#katalog" onClick={() => setMobileMenu(false)}>Katalog</a>
          <a href="#kenapa" onClick={() => setMobileMenu(false)}>Keunggulan</a>
          <a href="#status" onClick={() => setMobileMenu(false)}>Status pesanan</a>
          <a href="#bantuan" onClick={() => setMobileMenu(false)}>Bantuan</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button cart-button" aria-label="Buka keranjang" onClick={() => setCartOpen(true)}>
            <ShoppingBag size={19} />
            {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
          </button>
          <button className="admin-link" onClick={() => setAdminOpen(true)}>Panel admin</button>
          <button className="account-button" onClick={() => setLoginOpen(true)}>
            <UserRound size={17} />
            <span>{loggedIn ? "Akun saya" : "Masuk"}</span>
          </button>
          <button className="icon-button mobile-menu-button" aria-label="Menu" onClick={() => setMobileMenu((value) => !value)}>
            {mobileMenu ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section page-width">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> DIGITAL GOODS, MADE SIMPLE</div>
            <h1>Semua kebutuhan digital,<br /><em>lebih dekat.</em></h1>
            <p>Temukan akses premium, tools produktivitas, dan layanan digital dengan proses cepat, harga bersahabat, dan bantuan nyata.</p>
            <div className="hero-actions">
              <a href="#katalog" className="primary-button">Jelajahi katalog <ArrowRight size={17} /></a>
              <div className="hero-trust"><span className="avatar-stack"><i>R</i><i>Y</i><i>S</i></span><span><strong>1.2k+</strong> pelanggan terbantu</span></div>
            </div>
            <div className="hero-points"><span><Check size={14} /> Proses otomatis</span><span><Check size={14} /> Support responsif</span><span><Check size={14} /> Harga transparan</span></div>
          </div>
          <div className="hero-visual">
            <div className="hero-orbit orbit-a" />
            <div className="hero-orbit orbit-b" />
            <div className="floating-chip chip-top"><Zap size={16} /><span><b>Fast delivery</b><small>Pesanan diproses cepat</small></span></div>
            <div className="hero-showcase">
              <div className="showcase-glow" />
              <div className="showcase-content"><span className="showcase-kicker">RYY / SELECTED</span><strong>Upgrade<br /><span>your flow.</span></strong><p>Tools terbaik untuk hari yang lebih produktif.</p><div className="showcase-line"><span /> <small>01 — 04</small></div></div>
              <div className="showcase-badge"><Star size={13} fill="currentColor" /> pilihan pelanggan</div>
            </div>
            <div className="floating-chip chip-bottom"><ShieldCheck size={17} /><span><b>Aman & terpercaya</b><small>Sejak Maret 2025</small></span></div>
          </div>
        </section>

        <section className="benefit-strip page-width" id="kenapa">
          <div className="benefit-item"><span className="benefit-icon cyan"><Zap size={18} /></span><span><strong>Instan & praktis</strong><small>Pesanan masuk, langsung diproses.</small></span></div>
          <div className="benefit-item"><span className="benefit-icon purple"><BadgeCheck size={18} /></span><span><strong>Produk terkurasi</strong><small>Hanya layanan yang kami percaya.</small></span></div>
          <div className="benefit-item"><span className="benefit-icon orange"><Headphones size={18} /></span><span><strong>Ada yang bantu</strong><small>Tim support siap menjawab.</small></span></div>
        </section>

        <section className="catalog-section page-width" id="katalog">
          <div className="section-heading"><div><span className="section-kicker">KATALOG PRODUK</span><h2>Pilih yang kamu butuhkan.</h2></div><p>Mulai dari aplikasi premium sampai layanan harian. <br />Satu tempat, tanpa ribet.</p></div>
          <div className="catalog-toolbar"><div className="category-tabs">{categories.map((category) => <button key={category} className={activeCategory === category ? "active" : ""} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari produk..." aria-label="Cari produk" /></label></div>
          <div className="product-grid">{filteredProducts.map((product) => {
            const startingPrice = Math.min(...product.variants.map((variant) => variant.price));
            return <article className="product-card" key={product.id}>
              <button className="product-image-button" onClick={() => openProduct(product)} aria-label={`Lihat ${product.name}`}><ProductArt product={product} />{product.bestSeller && <span className="best-seller"><Star size={12} fill="currentColor" /> Best seller</span>}</button>
              <div className="product-card-body"><div className="product-meta"><span>{product.category}</span><span className="stock-dot"><i /> Tersedia</span></div><h3>{product.name}</h3><p>{product.description}</p><div className="product-card-footer"><div><small>Mulai dari</small><strong>{formatPrice(startingPrice)}</strong></div><button className="add-button" onClick={() => addToCart(product, product.variants[0])}><Plus size={18} /></button></div></div>
            </article>;
          })}</div>
          {filteredProducts.length === 0 && <div className="empty-state"><Search size={24} /><strong>Produk tidak ditemukan</strong><span>Coba gunakan kata kunci lain.</span></div>}
        </section>

        <section className="order-status-section page-width" id="status"><div className="section-heading"><div><span className="section-kicker">LACAK PESANAN</span><h2>Status order kamu.</h2></div><p>Setiap transaksi punya ID unik.<br />Simpan untuk cek progresnya.</p></div>{orders.length === 0 ? <div className="status-empty"><PackageCheck size={22} /><span>Belum ada pesanan. Pesananmu akan tampil di sini setelah checkout.</span></div> : <div className="order-list">{orders.slice(0, 4).map((order) => <button className="order-card" key={order.id} onClick={() => { setActiveOrder(order); setCheckoutOpen(true); }}><span className="order-icon"><PackageCheck size={18} /></span><span className="order-card-main"><strong>{order.id}</strong><small>{new Date(order.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · {order.items.length} item</small></span><span className={`status-pill ${order.status === "Selesai" ? "done" : order.status === "Menunggu verifikasi" ? "verify" : "pending"}`}>{order.status}</span><ArrowRight size={15} /></button>)}</div>}</section>

        <section className="service-banner page-width" id="bantuan"><div className="service-banner-copy"><span className="section-kicker">BUTUH BANTUAN?</span><h2>Belanja tenang,<br /><em>kami yang bantu.</em></h2><p>Kalau ada yang membingungkan, tim RYY STORE siap menemani dari pilih produk sampai selesai.</p><button className="light-button" onClick={() => showToast("Tim support akan segera menghubungi kamu")}>Hubungi support <ArrowRight size={16} /></button></div><div className="service-art"><div className="service-orb" /><div className="service-card card-back"><CircleHelp size={17} /><span>Need a hand?</span></div><div className="service-card card-front"><div className="support-avatar">R</div><div><strong>RYY Support</strong><small>Biasanya membalas dalam 5 menit</small></div><span className="online-dot" /></div></div></section>
      </main>

      <footer className="site-footer page-width"><div className="footer-brand"><span className="brand-mark"><Sparkles size={16} /></span><strong>RYY STORE</strong><p>Murah, cepat, dan terpercaya.</p></div><div className="footer-links"><span>© 2025–2026 RYY STORE</span><span>Made for your digital life.</span></div></footer>

      {toast && <div className="toast"><Check size={16} />{toast}</div>}

      {selectedProduct && selectedVariant && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedProduct(null)}><div className="product-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setSelectedProduct(null)} aria-label="Tutup"><X size={19} /></button><ProductArt product={selectedProduct} className="modal-art" /><div className="modal-body"><span className="section-kicker">{selectedProduct.category}</span><h2>{selectedProduct.name}</h2><p>{selectedProduct.description}</p><div className="variant-heading"><strong>Pilih varian</strong><span>{selectedProduct.variants.length} pilihan</span></div><div className="variant-list">{selectedProduct.variants.map((variant) => <button key={variant.name} className={selectedVariant.name === variant.name ? "selected" : ""} onClick={() => setSelectedVariant(variant)}><span>{variant.name}<small>{variant.stock} stok tersedia</small></span><strong>{formatPrice(variant.price)}</strong>{selectedVariant.name === variant.name && <Check size={16} />}</button>)}</div><div className="modal-purchase"><div><small>Total</small><strong>{formatPrice(selectedVariant.price)}</strong></div><button className="primary-button" onClick={() => addToCart(selectedProduct, selectedVariant)}>Tambah ke keranjang <ShoppingBag size={16} /></button></div></div></div></div>}

      {cartOpen && <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}><aside className="cart-drawer"><div className="drawer-head"><div><span className="section-kicker">KERANJANG KAMU</span><h2>{cartCount} item</h2></div><button className="modal-close" onClick={() => setCartOpen(false)} aria-label="Tutup keranjang"><X size={19} /></button></div>{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={32} /><strong>Keranjang masih kosong</strong><span>Produk pilihanmu akan muncul di sini.</span><button className="primary-button" onClick={() => setCartOpen(false)}>Lihat katalog <ArrowRight size={15} /></button></div> : <><div className="cart-lines">{cart.map((line) => <div className="cart-line" key={`${line.product.id}-${line.variant.name}`}><ProductArt product={line.product} className="cart-art" /><div className="cart-line-content"><strong>{line.product.name}</strong><span>{line.variant.name}</span><b>{formatPrice(line.variant.price * line.quantity)}</b><div className="quantity-control"><button onClick={() => updateQuantity(line, -1)} aria-label="Kurangi"><Minus size={13} /></button><span>{line.quantity}</span><button onClick={() => updateQuantity(line, 1)} aria-label="Tambah"><Plus size={13} /></button><button className="remove-line" onClick={() => setCart((current) => current.filter((item) => item !== line))} aria-label="Hapus"><Trash2 size={13} /></button></div></div></div>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{formatPrice(cartTotal)}</strong></div><small><LockKeyhole size={13} /> Pembayaran aman dan terenkripsi</small><button className="primary-button full" onClick={createOrder}>Buat order & bayar <CreditCard size={16} /></button></div></>}</aside></div>}

      {adminOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAdminOpen(false)}><div className="admin-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setAdminOpen(false)} aria-label="Tutup"><X size={19} /></button><div className="section-kicker">RYY STORE / ADMIN</div><h2>Verifikasi pesanan.</h2><p className="admin-modal-subtitle">Kelola bukti pembayaran yang masuk dan ubah status order setelah pengecekan.</p><div className="admin-stats"><div><strong>{orders.length}</strong><span>Total order</span></div><div><strong>{orders.filter((order) => order.status === "Menunggu verifikasi").length}</strong><span>Perlu dicek</span></div><div><strong>{orders.filter((order) => order.status === "Diproses").length}</strong><span>Diproses</span></div></div>{orders.length === 0 ? <div className="status-empty"><PackageCheck size={19} />Belum ada order masuk.</div> : <div className="admin-order-list">{orders.map((order) => <div className="admin-order" key={order.id}><div className="admin-order-head"><div><strong>{order.id}</strong><small>{new Date(order.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</small></div><span className={`status-pill ${order.status === "Menunggu verifikasi" ? "verify" : order.status === "Selesai" ? "done" : "pending"}`}>{order.status}</span></div><div className="admin-order-detail"><span>{order.items.map((item) => `${item.product.name} · ${item.variant.name}`).join(", ")}</span><strong>{formatPrice(order.total)}</strong></div>{order.proofData ? <div className="proof-preview"><img src={order.proofData} alt={`Bukti pembayaran ${order.id}`} /><div><strong>{order.proofName || "Bukti pembayaran"}</strong><small>Bukti tersedia untuk diperiksa.</small></div></div> : <div className="proof-missing"><Upload size={14} /> Belum ada bukti pembayaran</div>}<div className="admin-order-actions">{order.proofData && <button className="admin-action approve" onClick={() => reviewOrder(order, "Diproses")} disabled={order.status === "Diproses" || order.status === "Selesai"}>Setujui & proses</button>}<button className="admin-action" onClick={() => reviewOrder(order, "Menunggu pembayaran")} disabled={order.status === "Menunggu pembayaran"}>Minta ulang bukti</button><button className="admin-action done-action" onClick={() => reviewOrder(order, "Selesai")} disabled={order.status !== "Diproses"}>Tandai selesai</button></div></div>)}</div>}<button className="text-button" onClick={() => setAdminOpen(false)}>Kembali ke storefront <ArrowRight size={14} /></button></div></div>}

      {checkoutOpen && activeOrder && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCheckoutOpen(false)}><div className="checkout-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setCheckoutOpen(false)} aria-label="Tutup"><X size={19} /></button><div className="checkout-head"><span className="checkout-step active">1</span><span className="checkout-line" /><span className={`checkout-step ${activeOrder.status !== "Menunggu pembayaran" ? "active" : ""}`}>2</span><span className="checkout-line" /><span className={`checkout-step ${activeOrder.status === "Selesai" ? "active" : ""}`}>3</span></div><div className="checkout-title"><span className="section-kicker">ORDER {activeOrder.id}</span><h2>{activeOrder.status === "Menunggu pembayaran" ? "Selesaikan pembayaran." : "Order sedang diproses."}</h2><p>{activeOrder.status === "Menunggu pembayaran" ? "Gunakan QRIS merchant untuk membayar, lalu konfirmasi di bawah." : "Simpan ID order ini untuk mengecek progres transaksi."}</p></div><div className="checkout-total"><span>Total pembayaran</span><strong>{formatPrice(activeOrder.total)}</strong></div>{activeOrder.status === "Menunggu pembayaran" ? <div className="qris-panel"><div className="qris-placeholder"><span>QRIS</span><small>QR merchant akan tampil<br />setelah gateway dikonfigurasi</small></div><div className="qris-copy"><div className="qris-title"><CreditCard size={17} /><strong>Bayar dengan QRIS</strong></div><p>Integrasi gateway pembayaran belum memiliki kredensial merchant. Jangan tandai sudah membayar sebelum QR merchant resmi aktif.</p><div className="merchant-note"><ShieldCheck size={15} /><span>Transaksi akan diverifikasi admin setelah bukti pembayaran diterima.</span></div></div></div> : <div className="payment-pending"><div className="pending-icon"><Clock3 size={21} /></div><div><strong>{activeOrder.status}</strong><p>Admin akan memeriksa pembayaran dan memproses pesananmu.</p></div></div>}<div className="proof-upload"><div className="proof-upload-head"><strong>Upload bukti pembayaran</strong><span>JPG, PNG · maks. 4 MB</span></div><label className="proof-drop"><Upload size={17} /><span>{pendingProof?.name || activeOrder.proofName || "Pilih screenshot bukti transfer"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleProofUpload} /></label>{pendingProof && <button className="primary-button full" onClick={submitProof}>Kirim bukti untuk diverifikasi <Upload size={15} /></button>}{activeOrder.proofName && !pendingProof && <div className="proof-sent"><Check size={14} /> Bukti sudah dikirim dan menunggu pemeriksaan admin.</div>}</div><div className="order-id-row"><span>ID order</span><strong>{activeOrder.id}</strong><button onClick={() => copyOrderId(activeOrder.id)} aria-label="Salin ID order"><Copy size={15} /></button></div>{activeOrder.status === "Menunggu pembayaran" && <button className="primary-button full" onClick={markPaymentSubmitted}>Saya sudah membayar <Check size={16} /></button>}<button className="text-button" onClick={() => { setCheckoutOpen(false); document.getElementById("status")?.scrollIntoView({ behavior: "smooth" }); }}>Lihat semua status pesanan <ArrowRight size={14} /></button></div></div>}

      {loginOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setLoginOpen(false)}><div className="login-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setLoginOpen(false)} aria-label="Tutup"><X size={19} /></button><div className="login-side"><span className="brand-mark large"><Sparkles size={22} /></span><span className="section-kicker">RYY STORE / ACCOUNT</span><h2>Selamat datang<br /><em>kembali.</em></h2><p>Masuk untuk melihat pesanan, saldo, dan pengalaman belanja yang lebih personal.</p><div className="login-side-note"><ShieldCheck size={17} /><span>Data kamu tetap aman bersama kami.</span></div></div><div className="login-form-wrap"><div className="login-form-head"><span className="mobile-login-mark"><Sparkles size={17} /></span><h3>Masuk ke akun</h3><p>Belum punya akun? <button onClick={() => showToast("Fitur daftar akun segera hadir")}>Daftar sekarang</button></p></div><form onSubmit={submitLogin}><label>Username atau email<input required type="text" placeholder="Masukkan username atau email" autoComplete="username" /></label><label>Password<div className="password-input"><input required type="password" placeholder="Masukkan password" autoComplete="current-password" /><button type="button" onClick={() => showToast("Gunakan browser untuk mengelola visibilitas password")}>Lihat</button></div></label>{loginState === "error" && <div className="login-error">Login belum berhasil. Periksa kembali data kamu.</div>}{loginState === "success" ? <div className="login-success"><Check size={16} /> Login berhasil. Membuka akun...</div> : <button className="primary-button full" disabled={loginState === "loading"}>{loginState === "loading" ? "Memproses..." : "Masuk sebagai user"}<ArrowRight size={16} /></button>}</form><div className="login-divider"><span>atau</span></div><button className="google-button" onClick={() => showToast("Login Google segera hadir")}><span>G</span> Lanjutkan dengan Google</button><p className="login-security"><LockKeyhole size={13} /> Verifikasi keamanan aktif</p></div></div></div>}
    </div>
  );
}
