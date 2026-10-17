# Vulu FTBQuests Editor

**FTB Quests görev kitaplarını Minecraft'a girmeden düzenleyen masaüstü uygulaması.**
*A desktop editor for FTB Quests quest books, usable without launching Minecraft.*

Mod paketinin klasörünü açarsın; görev haritası, eşya ikonları, çeviriler ve bölüm resimleri oyundaki
gibi görünür. Görev ekler, düzenler, kaydedersin; oyunu açtığında değişiklikler oradadır.

> Bu proje Feed The Beast ile bağlantılı değildir ve onlar tarafından desteklenmez.
> "FTB Quests", Feed The Beast'in modudur; bu editör sadece onun dosya biçimini okuyup yazar.

Hedef: Minecraft **1.18 – 1.20.1** (klasik SNBT); **1.21+** (`lang/` dosyaları) desteklenir ama gerçek bir
paketle henüz doğrulanmadı.

## Özellikler

- **İki düzenleme modu** (ilk açılışta sorulur, üst çubuktan değiştirilir):
  - **Basit (önerilen):** oyun içindeki FTB Quests gibi. Boş yere sağ tıklayıp şart türünü seçerek görev
    eklenir; göreve tıklayınca açılan pencerede başlık, açıklama, şartlar, ödüller ve gereksinimler düzenlenir.
  - **Gelişmiş:** bütün ayarlar sağ panelde, ham SNBT düzenleme dahil.
- **Görev haritası:** sürükle-bırak, Ctrl+tık ile çoklu seçim, bağımlılık çizgileri, bölüm resimleri
  (bir görev tamamlanınca beliren resimler dahil), FTB'nin kendi şekil dokuları ve tema renkleri.
- **Eşya ikonları ve isimleri:** vanilla jar'ı, `mods/*.jar`, KubeJS ve etkin kaynak paketlerinden okunur.
  Düz eşyalar, bloklar ve Blockbench tarzı 3D modeller envanterdeki açıyla çizilir. Eşya seçicide JEI gibi
  arama yapılır (`@mod` ile moda göre süzme).
- **Renkli metin düzenleyici:** `&a`, `&l` gibi Minecraft kodları yazmadan renk ve biçim verilir;
  `<grad>`, `<rainb>` gibi metin efekti etiketleri korunur.
- **Çeviriler:** `{ftbquests.chapter…}` gibi anahtarla yazılmış metinler gerçek haliyle gösterilir ve
  düzenlenince paketin KubeJS dil dosyasına yazılır.
- **Resim ekleme:** bilgisayardan seçilen PNG, paketin `kubejs/assets/<ns>/textures/quest_images/`
  klasörüne kopyalanıp bölüme resim olarak eklenir.
- **Güvenli kaydetme:** dosyalar birebir aynı geri yazılır, sadece değişenler kaydedilir, her kayıttan önce
  yedek alınır (`config/ftbquests/editor-backups/`), geri al / yinele.

## Kullanım

1. Oyunu (veya sunucuyu) **kapat**; açıkken FTB Quests kendi kopyasını kaydedip değişikliklerini ezebilir.
2. **Mod paketi aç** ile paketin instance klasörünü seç (içinde `mods` ve `config` olan; ör.
   `CurseForge\Instances\PaketAdı`).
3. Düzenle, **Ctrl+S** ile kaydet. Oyun açıkken KubeJS dil dosyası veya resim değiştiyse **F3+T** ile kaynakları yenile.

| İşlem | Basit mod |
|---|---|
| Yeni görev | Haritada boş yere sağ tık → şart türü |
| Görevi düzenle | Göreve tıkla |
| Gereksinim ekle | Görev penceresinde "Gereksinimler +" ya da Ctrl+tık ile seç → hedefe sağ tık |
| Bölüm ekle / taşı | Soldaki yeşil **+** / bölüme sağ tık |
| Geri al / yinele / kaydet | Ctrl+Z / Ctrl+Y / Ctrl+S |

## Geliştirme

Gerekenler: Node.js 20+, Rust (Tauri 2 için), Windows'ta WebView2.

```bash
npm install
npm run tauri dev     # masaüstü uygulaması
npm run dev           # sadece tarayıcı (Chrome/Edge), http://localhost:1420
npm test              # testler
npm run tauri build   # kurulum dosyası (src-tauri/target/release/bundle)
```

Tarayıcı sürümü klasör erişimi için File System Access API kullanır (Chrome/Edge); vanilla Minecraft
jar'ına erişemediği için `minecraft:` eşyalarının ikonları orada eksik kalır.

### Gerçek paketlerle test

`samples/` klasörüne (git'e girmez) bir mod paketi ya da sadece `config/ftbquests/quests` klasörü konursa
`npm test` her paket için şunları doğrular: bütün `.snbt` dosyaları birebir aynı geri yazılıyor, kitap
hatasız yükleniyor, ödül tabloları ve çeviriler çözülüyor, ikonların çoğu bulunuyor, tek bir düzenleme
sadece ilgili dosyayı değiştiriyor. `npm run dev` açıkken `http://localhost:1420/?sample=<klasör>` paketi
tarayıcıda salt okunur açar.

Doğrulanan paketler: Tech Revolution (1.19.2, 4.393 görev), MC Eternal 2 (1.20.1, 1.521 görev, 5.043 çeviri).

### Yapı

- `src/core/snbt/` – biçimi ve sayı tiplerini koruyan SNBT okuyucu/yazıcı
- `src/core/book.ts` – görev kitabı modeli: yükleme, kaydetme, geri al, çeviriler, resimler, referans temizliği
- `src/core/assets/` – zip okuyucu, kaynak indeksi, model → ikon/isim çözümleme
- `src/core/mcFormat.ts`, `text.ts`, `jsonText.ts` – Minecraft biçim kodları, çeviri anahtarları, dil dosyası düzenleme
- `src/ui/` – React arayüzü (harita için React Flow); `src/ui/simple/` basit mod pencereleri ve menüleri
- `src/platform/` – dosya erişimi (Tauri, tarayıcı, geliştirme/test)
- `src-tauri/` – Rust tarafı: dosya okuma/yazma, yol doğrulama, yedekleme, mod jar'larından aralıklı okuma

## Lisans

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later).

Minecraft, FTB Quests ve mod dokuları bu depoda yer almaz; editör onları kullanıcının kendi mod paketinden
okur. Arayüzdeki piksel yazı tipi [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans)
(SIL Open Font License 1.1) paketiyle gelir.
