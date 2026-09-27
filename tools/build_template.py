#!/usr/bin/env python3
"""
Builds the 300-item Indonesian grocery (warung sembako) product template.

Outputs:
  templates/Template_Produk_Warung_300.csv   (for Excel / Google Sheets editing)
  src/TemplateData.gs                        (bundled in the Apps Script project)

Prices are indicative retail prices (Rupiah) for Java in 2026; edit them in
the CSV before importing. Tier prices are *per unit* prices that apply when
the quantity reaches bundle_qty / wholesale_qty.

Usage: python3 tools/build_template.py
"""
import csv
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (name, category, unit, retail_price)
ITEMS = [
    # ---------------- Sembako ----------------
    ("Beras Medium Curah", "Sembako", "kg", 13500),
    ("Beras Premium Curah", "Sembako", "kg", 15500),
    ("Beras Ketan Putih Curah", "Sembako", "kg", 22000),
    ("Beras Pandan Wangi 5 kg", "Sembako", "pcs", 78000),
    ("Beras Rojolele 5 kg", "Sembako", "pcs", 82000),
    ("Beras Sania Premium 5 kg", "Sembako", "pcs", 80000),
    ("Beras Topi Koki 5 kg", "Sembako", "pcs", 79000),
    ("Beras SPHP Bulog 5 kg", "Sembako", "pcs", 62500),
    ("Minyakita Minyak Goreng 1 L", "Sembako", "liter", 15700),
    ("Minyak Goreng Curah", "Sembako", "liter", 17000),
    ("Bimoli Minyak Goreng 1 L", "Sembako", "pcs", 21000),
    ("Bimoli Minyak Goreng 2 L", "Sembako", "pcs", 40500),
    ("Sania Minyak Goreng 1 L", "Sembako", "pcs", 20000),
    ("Sania Minyak Goreng 2 L", "Sembako", "pcs", 38500),
    ("Filma Minyak Goreng 2 L", "Sembako", "pcs", 39500),
    ("Fortune Minyak Goreng 1 L", "Sembako", "pcs", 19500),
    ("Fortune Minyak Goreng 2 L", "Sembako", "pcs", 37500),
    ("Tropical Minyak Goreng 2 L", "Sembako", "pcs", 39000),
    ("Gula Pasir Curah", "Sembako", "kg", 17500),
    ("Gulaku Gula Pasir 1 kg", "Sembako", "pcs", 18500),
    ("Rose Brand Gula Pasir 1 kg", "Sembako", "pcs", 18000),
    ("Gula Merah Jawa", "Sembako", "kg", 24000),
    ("Telur Ayam Negeri", "Sembako", "kg", 29000),
    ("Telur Ayam Kampung", "Sembako", "pcs", 2500),
    ("Telur Bebek", "Sembako", "pcs", 3500),
    ("Tepung Terigu Segitiga Biru 1 kg", "Sembako", "pcs", 14000),
    ("Tepung Terigu Cakra Kembar 1 kg", "Sembako", "pcs", 15000),
    ("Tepung Terigu Kunci Biru 1 kg", "Sembako", "pcs", 13500),
    ("Tepung Beras Rose Brand 500 g", "Sembako", "pcs", 8500),
    ("Tepung Tapioka Rose Brand 500 g", "Sembako", "pcs", 7500),
    ("Sajiku Tepung Bumbu 80 g", "Sembako", "pcs", 3000),
    ("Kobe Tepung Bumbu Serbaguna 75 g", "Sembako", "pcs", 3000),
    ("Indomie Goreng 85 g", "Sembako", "pcs", 3500),
    ("Indomie Soto Mie 70 g", "Sembako", "pcs", 3200),
    ("Indomie Ayam Bawang 69 g", "Sembako", "pcs", 3200),
    ("Indomie Kari Ayam 72 g", "Sembako", "pcs", 3400),
    ("Indomie Rendang 91 g", "Sembako", "pcs", 3700),
    ("Indomie Goreng Aceh 90 g", "Sembako", "pcs", 3700),
    ("Indomie Goreng Jumbo 129 g", "Sembako", "pcs", 4500),
    ("Mie Sedaap Goreng 90 g", "Sembako", "pcs", 3500),
    ("Mie Sedaap Soto 75 g", "Sembako", "pcs", 3200),
    ("Mie Sedaap Kari Spesial 87 g", "Sembako", "pcs", 3400),
    ("Mie Sedaap Korean Spicy Chicken", "Sembako", "pcs", 4500),
    ("Sarimi Isi 2 Ayam Kecap", "Sembako", "pcs", 4000),
    ("Supermi Ayam Bawang 75 g", "Sembako", "pcs", 3000),
    ("Pop Mie Rasa Ayam 75 g", "Sembako", "pcs", 6000),
    ("Pop Mie Rasa Baso 75 g", "Sembako", "pcs", 6000),
    ("Mie Telur Cap 3 Ayam 200 g", "Sembako", "pcs", 5500),
    ("Bihun Jagung Padamu 175 g", "Sembako", "pcs", 5000),
    ("Garam Refina 250 g", "Sembako", "pcs", 3500),
    ("Garam Dapur Cap Kapal 500 g", "Sembako", "pcs", 3000),
    ("Royco Kaldu Ayam 8 g (isi 12)", "Sembako", "renteng", 6000),
    ("Masako Kaldu Ayam 9 g (isi 12)", "Sembako", "renteng", 6000),
    ("Masako Kaldu Sapi 9 g (isi 12)", "Sembako", "renteng", 6000),
    ("Sasa Penyedap 100 g", "Sembako", "pcs", 5500),
    ("Ajinomoto 100 g", "Sembako", "pcs", 6000),
    ("Kecap Manis Bango 220 ml", "Sembako", "pcs", 11000),
    ("Kecap Manis Bango 520 ml", "Sembako", "pcs", 23000),
    ("Kecap Manis ABC 135 ml", "Sembako", "pcs", 6500),
    ("Kecap Manis Sedaap 200 ml", "Sembako", "pcs", 9000),
    ("Saus Sambal ABC 135 ml", "Sembako", "pcs", 8500),
    ("Saus Sambal Indofood 135 ml", "Sembako", "pcs", 8000),
    ("Saus Tomat ABC 135 ml", "Sembako", "pcs", 7500),
    ("Terasi Udang ABC 4 g (isi 10)", "Sembako", "renteng", 5000),
    ("Bumbu Racik Nasi Goreng Indofood", "Sembako", "pcs", 3000),
    ("Bawang Merah", "Sembako", "kg", 38000),
    ("Bawang Putih", "Sembako", "kg", 34000),
    ("Cabai Rawit Merah", "Sembako", "kg", 60000),
    ("Ladaku Merica Bubuk 4 g (isi 10)", "Sembako", "renteng", 5000),
    ("Desaku Ketumbar Bubuk 4 g (isi 10)", "Sembako", "renteng", 5000),
    ("Santan Kara 65 ml", "Sembako", "pcs", 3800),
    ("Santan Sasa 65 ml", "Sembako", "pcs", 3500),
    ("Susu Kental Manis Frisian Flag 370 g", "Sembako", "pcs", 13500),
    ("Susu Kental Manis Indomilk 370 g", "Sembako", "pcs", 12500),
    ("Susu Kental Manis Frisian Flag Sachet (isi 6)", "Sembako", "renteng", 9500),
    ("Margarin Blue Band 200 g", "Sembako", "pcs", 10500),
    ("Margarin Palmia 200 g", "Sembako", "pcs", 8500),
    ("Kacang Hijau Curah", "Sembako", "kg", 26000),
    ("Kacang Tanah Curah", "Sembako", "kg", 32000),
    ("Sarden ABC Saus Tomat 155 g", "Sembako", "pcs", 11000),
    ("Sarden Botan 155 g", "Sembako", "pcs", 11500),
    ("Kornet Sapi Pronas 198 g", "Sembako", "pcs", 25000),
    # ---------------- Minuman ----------------
    ("Aqua Air Mineral 330 ml", "Minuman", "pcs", 3000),
    ("Aqua Air Mineral 600 ml", "Minuman", "pcs", 4000),
    ("Aqua Air Mineral 1500 ml", "Minuman", "pcs", 7000),
    ("Le Minerale 600 ml", "Minuman", "pcs", 4000),
    ("Le Minerale 1500 ml", "Minuman", "pcs", 6500),
    ("Club Air Mineral 600 ml", "Minuman", "pcs", 3000),
    ("Teh Pucuk Harum 350 ml", "Minuman", "pcs", 4000),
    ("Teh Botol Sosro 450 ml", "Minuman", "pcs", 5500),
    ("Teh Kotak Jasmine 300 ml", "Minuman", "pcs", 4500),
    ("Fruit Tea Blackcurrant 500 ml", "Minuman", "pcs", 6000),
    ("Frestea Jasmine 500 ml", "Minuman", "pcs", 5500),
    ("Teh Gelas Original 170 ml", "Minuman", "pcs", 1500),
    ("Coca-Cola 390 ml", "Minuman", "pcs", 6500),
    ("Sprite 390 ml", "Minuman", "pcs", 6500),
    ("Fanta Stroberi 390 ml", "Minuman", "pcs", 6500),
    ("Pocari Sweat 500 ml", "Minuman", "pcs", 8000),
    ("Mizone Lychee Lemon 500 ml", "Minuman", "pcs", 6000),
    ("Minute Maid Pulpy Orange 300 ml", "Minuman", "pcs", 7000),
    ("Floridina Orange 360 ml", "Minuman", "pcs", 4000),
    ("Ale-Ale Jeruk 200 ml", "Minuman", "pcs", 1500),
    ("Kapal Api Special Mix 10x24 g", "Minuman", "renteng", 14500),
    ("Kopi Kapal Api Special 165 g", "Minuman", "pcs", 14500),
    ("Kopi ABC Susu 10x31 g", "Minuman", "renteng", 15000),
    ("Good Day Cappuccino 10x25 g", "Minuman", "renteng", 17000),
    ("Good Day Mocacinno 10x20 g", "Minuman", "renteng", 16500),
    ("Luwak White Koffie 10x20 g", "Minuman", "renteng", 15500),
    ("Torabika Cappuccino 10x25 g", "Minuman", "renteng", 17500),
    ("Indocafe Coffeemix 10x20 g", "Minuman", "renteng", 14500),
    ("Nescafe Classic 10x2 g", "Minuman", "renteng", 12000),
    ("TOP Kopi Susu 10x25 g", "Minuman", "renteng", 12500),
    ("Teh Celup Sariwangi isi 25", "Minuman", "pcs", 7000),
    ("Teh Celup Tong Tji isi 25", "Minuman", "pcs", 8500),
    ("Teh Celup Sosro isi 30", "Minuman", "pcs", 8000),
    ("Milo Sachet 10x22 g", "Minuman", "renteng", 17000),
    ("Energen Coklat 10x30 g", "Minuman", "renteng", 16000),
    ("Energen Vanila 10x30 g", "Minuman", "renteng", 16000),
    ("Nutrisari Jeruk Peras 10x14 g", "Minuman", "renteng", 12000),
    ("Pop Ice Coklat 10x25 g", "Minuman", "renteng", 10000),
    ("Dancow Fortigro Instant 800 g", "Minuman", "pcs", 105000),
    ("Bear Brand Susu Steril 189 ml", "Minuman", "pcs", 10500),
    ("Ultra Milk Coklat 250 ml", "Minuman", "pcs", 7000),
    ("Ultra Milk Full Cream 1 L", "Minuman", "pcs", 20000),
    ("Indomilk Kotak Coklat 190 ml", "Minuman", "pcs", 4500),
    ("Frisian Flag UHT Coklat 225 ml", "Minuman", "pcs", 6000),
    ("Yakult isi 5", "Minuman", "pcs", 11000),
    ("Cimory Yogurt Drink 250 ml", "Minuman", "pcs", 9500),
    ("Kratingdaeng 150 ml", "Minuman", "pcs", 7000),
    ("Extra Joss 6x4 g", "Minuman", "renteng", 12000),
    ("Hemaviton Jreng 6x4 g", "Minuman", "renteng", 12000),
    ("Adem Sari Chingku 350 ml", "Minuman", "pcs", 7000),
    ("Marjan Sirup Cocopandan 460 ml", "Minuman", "pcs", 23000),
    ("ABC Sirup Squash Jeruk 460 ml", "Minuman", "pcs", 22000),
    # ---------------- Rokok ----------------
    ("Gudang Garam Surya 12", "Rokok", "pcs", 27000),
    ("Gudang Garam Surya 16", "Rokok", "pcs", 34500),
    ("Gudang Garam Filter International 12", "Rokok", "pcs", 24500),
    ("Gudang Garam Merah 12", "Rokok", "pcs", 20000),
    ("Sampoerna A Mild 16", "Rokok", "pcs", 34000),
    ("Sampoerna A Mild 12", "Rokok", "pcs", 26000),
    ("Sampoerna Kretek 12", "Rokok", "pcs", 17500),
    ("Sampoerna U Mild 16", "Rokok", "pcs", 26000),
    ("Dji Sam Soe Kretek 12", "Rokok", "pcs", 22000),
    ("Dji Sam Soe Magnum Filter 12", "Rokok", "pcs", 27000),
    ("Djarum Super 12", "Rokok", "pcs", 26500),
    ("Djarum Super MLD 16", "Rokok", "pcs", 31000),
    ("Djarum 76 Kretek 12", "Rokok", "pcs", 17500),
    ("Djarum Coklat 12", "Rokok", "pcs", 16500),
    ("LA Lights 16", "Rokok", "pcs", 32000),
    ("LA Bold 20", "Rokok", "pcs", 36500),
    ("Marlboro Merah 20", "Rokok", "pcs", 42500),
    ("Marlboro Filter Black 20", "Rokok", "pcs", 37500),
    ("Marlboro Ice Burst 16", "Rokok", "pcs", 38000),
    ("Class Mild 16", "Rokok", "pcs", 30000),
    ("Esse Change 16", "Rokok", "pcs", 34000),
    ("Esse Mild 16", "Rokok", "pcs", 31000),
    ("Magnum Filter 12", "Rokok", "pcs", 27000),
    ("Dunhill Filter 16", "Rokok", "pcs", 32500),
    ("Lucky Strike Filter 16", "Rokok", "pcs", 30000),
    ("Camel Filter 16", "Rokok", "pcs", 29500),
    ("Wismilak Diplomat 12", "Rokok", "pcs", 23000),
    ("Sukun Kretek 12", "Rokok", "pcs", 15000),
    # ---------------- Snack ----------------
    ("Chitato Sapi Panggang 68 g", "Snack", "pcs", 11500),
    ("Chitato Keju Supreme 68 g", "Snack", "pcs", 11500),
    ("Lay's Rumput Laut 68 g", "Snack", "pcs", 11500),
    ("Qtela Singkong Balado 60 g", "Snack", "pcs", 8500),
    ("Qtela Tempe Original 55 g", "Snack", "pcs", 8500),
    ("Taro Net Seaweed 65 g", "Snack", "pcs", 7500),
    ("Cheetos Jagung Bakar 40 g", "Snack", "pcs", 5500),
    ("Chiki Balls Keju 55 g", "Snack", "pcs", 6500),
    ("Potabee BBQ 68 g", "Snack", "pcs", 11000),
    ("Kusuka Keripik Singkong Balado 180 g", "Snack", "pcs", 10000),
    ("Beng-Beng 20 g", "Snack", "pcs", 2500),
    ("SilverQueen Almond 58 g", "Snack", "pcs", 16500),
    ("Cadbury Dairy Milk 62 g", "Snack", "pcs", 15000),
    ("TOP Coklat 9 g", "Snack", "pcs", 2000),
    ("Oreo Vanilla 133 g", "Snack", "pcs", 9500),
    ("Oreo Chocolate Cream 133 g", "Snack", "pcs", 9500),
    ("Roma Kelapa 300 g", "Snack", "pcs", 11000),
    ("Roma Malkist Crackers 105 g", "Snack", "pcs", 6500),
    ("Biskuat Coklat 134 g", "Snack", "pcs", 6500),
    ("Tango Wafer Coklat 130 g", "Snack", "pcs", 9500),
    ("Nabati Richeese Wafer 50 g", "Snack", "pcs", 2500),
    ("Good Time Chocochips 72 g", "Snack", "pcs", 8000),
    ("Chocolatos Wafer Roll 24 g", "Snack", "pcs", 2000),
    ("Gery Saluut Malkist Coklat 100 g", "Snack", "pcs", 5500),
    ("Better Vanilla 100 g", "Snack", "pcs", 5500),
    ("Kacang Garuda Kulit 200 g", "Snack", "pcs", 15000),
    ("Kacang Atom Garuda 100 g", "Snack", "pcs", 7500),
    ("Sukro Kacang Oven 100 g", "Snack", "pcs", 6500),
    ("Pilus Garuda Tic Tac 95 g", "Snack", "pcs", 5500),
    ("Momogi Jagung Bakar 8 g", "Snack", "pcs", 1000),
    ("Tos Tos Nacho Cheese 140 g", "Snack", "pcs", 10000),
    ("Kerupuk Udang Finna 100 g", "Snack", "pcs", 9000),
    ("Sari Roti Tawar Kupas", "Snack", "pcs", 22000),
    ("Sari Roti Sobek Coklat", "Snack", "pcs", 16000),
    ("Sari Roti Sandwich Coklat", "Snack", "pcs", 5500),
    ("Roti Aoka Coklat", "Snack", "pcs", 3000),
    ("Permen Kopiko 150 g", "Snack", "pcs", 10000),
    ("Permen Relaxa 125 g", "Snack", "pcs", 8000),
    ("Permen Milkita 30 pcs", "Snack", "pcs", 10000),
    ("Mentos Mint Roll", "Snack", "pcs", 3000),
    ("Yupi Gummy 20 g", "Snack", "pcs", 3000),
    ("Selai Morin Strawberry 150 g", "Snack", "pcs", 20000),
    # ---------------- Toiletries ----------------
    ("Sabun Mandi Lifebuoy Merah 110 g", "Toiletries", "pcs", 5000),
    ("Lifebuoy Body Wash Refill 450 ml", "Toiletries", "pcs", 25000),
    ("Sabun Lux Batang 110 g", "Toiletries", "pcs", 5000),
    ("Sabun Giv Batang 76 g", "Toiletries", "pcs", 3500),
    ("Sabun Nuvo Batang 72 g", "Toiletries", "pcs", 3500),
    ("Sabun Dettol Batang 105 g", "Toiletries", "pcs", 6500),
    ("Biore Body Foam Refill 450 ml", "Toiletries", "pcs", 26000),
    ("Sunsilk Black Shine 170 ml", "Toiletries", "pcs", 26000),
    ("Sunsilk Sachet (isi 12)", "Toiletries", "renteng", 6000),
    ("Pantene Sachet (isi 12)", "Toiletries", "renteng", 7000),
    ("Clear Men Sachet (isi 12)", "Toiletries", "renteng", 7500),
    ("Lifebuoy Shampoo 170 ml", "Toiletries", "pcs", 22000),
    ("Pepsodent 190 g", "Toiletries", "pcs", 13500),
    ("Pepsodent 75 g", "Toiletries", "pcs", 6500),
    ("Ciptadent 190 g", "Toiletries", "pcs", 10000),
    ("Close Up 160 g", "Toiletries", "pcs", 14000),
    ("Formula Pasta Gigi 190 g", "Toiletries", "pcs", 12000),
    ("Sikat Gigi Formula Soft", "Toiletries", "pcs", 5000),
    ("Rinso Anti Noda 770 g", "Toiletries", "pcs", 24000),
    ("Rinso Cair 800 ml", "Toiletries", "pcs", 18000),
    ("Rinso Sachet (isi 6)", "Toiletries", "renteng", 12000),
    ("So Klin Pembersih Lantai 800 ml", "Toiletries", "pcs", 12500),
    ("So Klin Softergent 770 g", "Toiletries", "pcs", 21000),
    ("Daia Deterjen Putih 850 g", "Toiletries", "pcs", 20000),
    ("Attack Easy 800 g", "Toiletries", "pcs", 22000),
    ("Sunlight Jeruk Nipis 755 ml", "Toiletries", "pcs", 18500),
    ("Sunlight Jeruk Nipis 210 ml", "Toiletries", "pcs", 5000),
    ("Mama Lemon 780 ml", "Toiletries", "pcs", 17000),
    ("Molto Pewangi Refill 800 ml", "Toiletries", "pcs", 21000),
    ("Molto Sachet (isi 6)", "Toiletries", "renteng", 7000),
    ("Downy Pewangi Refill 720 ml", "Toiletries", "pcs", 28000),
    ("Wipol Karbol 780 ml", "Toiletries", "pcs", 13500),
    ("Harpic Pembersih Kloset 450 ml", "Toiletries", "pcs", 17000),
    ("Bayclin Pemutih 500 ml", "Toiletries", "pcs", 9500),
    ("Vixal Pembersih Porselen 780 ml", "Toiletries", "pcs", 13000),
    ("Stella Pengharum Ruangan 70 g", "Toiletries", "pcs", 11000),
    ("Softex Daun Sirih 20 pcs", "Toiletries", "pcs", 11500),
    ("Charm Extra Maxi 10 pcs", "Toiletries", "pcs", 12000),
    ("Laurier Relax Night 8 pcs", "Toiletries", "pcs", 10500),
    ("MamyPoko Pants M 20 pcs", "Toiletries", "pcs", 55000),
    ("Sweety Silver Pants L 20 pcs", "Toiletries", "pcs", 52000),
    ("Rexona Men Roll On 50 ml", "Toiletries", "pcs", 19000),
    ("Marina Hand Body Lotion 200 ml", "Toiletries", "pcs", 13000),
    ("Citra Hand Body Lotion 230 ml", "Toiletries", "pcs", 17000),
    ("Zwitsal Baby Oil 100 ml", "Toiletries", "pcs", 18000),
    ("Minyak Telon Konicare 60 ml", "Toiletries", "pcs", 17000),
    ("Minyak Kayu Putih Cap Lang 60 ml", "Toiletries", "pcs", 22500),
    ("Tissue Paseo 250 Sheets", "Toiletries", "pcs", 15500),
    ("Tissue Nice 180 Sheets", "Toiletries", "pcs", 9000),
    ("Tissue Basah Mitu 50 pcs", "Toiletries", "pcs", 13000),
    ("Sabun Colek Ekonomi 400 g", "Toiletries", "pcs", 7000),
    # ---------------- Gas & Air ----------------
    ("Gas LPG 3 kg (Isi Ulang)", "Gas & Air", "pcs", 22000),
    ("Bright Gas 5,5 kg (Isi Ulang)", "Gas & Air", "pcs", 98000),
    ("Gas LPG 12 kg (Isi Ulang)", "Gas & Air", "pcs", 205000),
    ("Tabung LPG 3 kg + Isi (Baru)", "Gas & Air", "pcs", 180000),
    ("Aqua Galon 19 L (Isi Ulang)", "Gas & Air", "pcs", 21000),
    ("Le Minerale Galon 15 L (Isi Ulang)", "Gas & Air", "pcs", 20000),
    ("Club Galon 19 L (Isi Ulang)", "Gas & Air", "pcs", 17000),
    ("Cleo Galon 19 L (Isi Ulang)", "Gas & Air", "pcs", 20000),
    ("Vit Galon 19 L (Isi Ulang)", "Gas & Air", "pcs", 17000),
    ("Air Isi Ulang Depot per Galon", "Gas & Air", "pcs", 6000),
    ("Galon Kosong Aqua (Jaminan)", "Gas & Air", "pcs", 45000),
    # ---------------- Lainnya ----------------
    ("Korek Api Gas Tokai", "Lainnya", "pcs", 3000),
    ("Korek Api Kayu Cap Tiga (isi 10)", "Lainnya", "pcs", 5000),
    ("Lilin Batang Kecil (isi 10)", "Lainnya", "pcs", 5000),
    ("Baterai ABC AA isi 2", "Lainnya", "pcs", 7000),
    ("Baterai ABC Alkaline AA isi 2", "Lainnya", "pcs", 15000),
    ("Baterai ABC AAA isi 2", "Lainnya", "pcs", 7000),
    ("Obat Nyamuk Bakar Baygon (isi 10)", "Lainnya", "pcs", 7500),
    ("HIT Aerosol 600 ml", "Lainnya", "pcs", 36000),
    ("Autan Lotion Sachet (isi 6)", "Lainnya", "renteng", 6000),
    ("Tolak Angin Cair Sachet", "Lainnya", "pcs", 4000),
    ("Antangin JRG Sachet", "Lainnya", "pcs", 4000),
    ("Bodrex Strip 4 Tablet", "Lainnya", "pcs", 3000),
    ("Paramex Strip 4 Tablet", "Lainnya", "pcs", 3000),
    ("Promag Strip 12 Tablet", "Lainnya", "pcs", 10000),
    ("Mixagrip Flu Strip 4 Kaplet", "Lainnya", "pcs", 3000),
    ("Panadol Biru Strip 10 Kaplet", "Lainnya", "pcs", 12500),
    ("Oskadon Strip 4 Tablet", "Lainnya", "pcs", 3000),
    ("Diapet Strip 4 Kapsul", "Lainnya", "pcs", 5000),
    ("Balsem Geliga 20 g", "Lainnya", "pcs", 11000),
    ("Koyo Cabe Hansaplast", "Lainnya", "pcs", 5000),
    ("Kantong Plastik Kresek Hitam 15", "Lainnya", "pcs", 7000),
    ("Plastik Klip Ukuran Sedang (isi 100)", "Lainnya", "pcs", 8000),
    ("Karet Gelang 100 g", "Lainnya", "pcs", 6000),
    ("Sedotan Plastik (isi 100)", "Lainnya", "pcs", 5000),
    ("Kertas Nasi Coklat (isi 100)", "Lainnya", "pcs", 12000),
    ("Sendok Plastik (isi 50)", "Lainnya", "pcs", 5000),
    ("Gelas Plastik Cup 16 oz (isi 50)", "Lainnya", "pcs", 10000),
    ("Pulpen Standard AE7", "Lainnya", "pcs", 2500),
    ("Buku Tulis Sidu 38 Lembar", "Lainnya", "pcs", 4000),
    ("Lem Castol 30 g", "Lainnya", "pcs", 3000),
    ("Isolasi Bening Nachi", "Lainnya", "pcs", 5000),
    ("Kapur Barus Bagus (isi 6)", "Lainnya", "pcs", 5000),
    ("Obat Nyamuk Semprot Baygon 600 ml", "Lainnya", "pcs", 38000),
    ("Spons Cuci Piring Scotch-Brite", "Lainnya", "pcs", 5000),
]

COMPANY = {"Sembako": "1001", "Minuman": "2002", "Rokok": "3003", "Snack": "4004",
           "Toiletries": "5005", "Gas & Air": "6006", "Lainnya": "7007"}

HEADERS = ["barcode", "name", "category", "unit", "price_retail", "price_bundle", "bundle_qty",
           "price_wholesale", "wholesale_qty", "cost_price", "stock", "min_stock", "expiry_date"]


def ean13(twelve: str) -> str:
    s = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(twelve))
    return twelve + str((10 - s % 10) % 10)


def down50(x: float) -> int:
    return int(x // 50 * 50)


def near50(x: float) -> int:
    return int(round(x / 50.0) * 50)


def tiers(name, cat, unit, price):
    """Returns (bundle_qty, bundle_factor, wholesale_qty, wholesale_factor, cost_factor, min_stock)."""
    if cat == "Gas & Air":
        return 0, 1, 0, 1, 0.86, 5
    if cat == "Rokok":
        return 5, 0.99, 10, 0.975, 0.93, 10
    if unit == "kg":
        return 5, 0.98, 25, 0.955, 0.88, 10
    if unit == "liter":
        return 6, 0.985, 12, 0.965, 0.9, 6
    if unit == "renteng":
        return 3, 0.98, 12, 0.95, 0.87, 5
    if price >= 50000:
        return 2, 0.985, 5, 0.965, 0.9, 3
    if "Indomie" in name or "Mie Sedaap" in name or "Supermi" in name or "Sarimi" in name:
        return 5, 0.95, 40, 0.9, 0.84, 40
    if cat == "Minuman":
        return 6, 0.94, 24, 0.88, 0.8, 24
    return 3, 0.96, 12, 0.92, 0.84, 10


def build_rows():
    seen = set()
    rows = []
    seq = {}
    loose = 0
    for name, cat, unit, price in ITEMS:
        key = name.lower()
        if key in seen:
            raise SystemExit("Duplicate item: " + name)
        seen.add(key)
        if unit in ("kg",) or "Curah" in name:
            loose += 1
            barcode = ean13("20" + str(900000000 + loose).zfill(10))
        else:
            seq[cat] = seq.get(cat, 0) + 1
            barcode = ean13("899" + COMPANY[cat] + str(seq[cat]).zfill(5))
        bq, bf, wq, wf, cf, mn = tiers(name, cat, unit, price)
        bp = down50(price * bf) if bq else 0
        wp = down50(price * wf) if wq else 0
        if bp >= price:
            bp, bq = 0, 0
        if wp >= (bp or price):
            wp, wq = 0, 0
        cost = near50(price * cf)
        rows.append([barcode, name, cat, unit, price, bp, bq, wp, wq, cost, 0, mn, ""])
    if len(rows) != 300:
        raise SystemExit("Expected 300 items, got %d" % len(rows))
    return rows


def main():
    rows = build_rows()
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADERS)
    w.writerows(rows)
    text = buf.getvalue()

    os.makedirs(os.path.join(ROOT, "templates"), exist_ok=True)
    with open(os.path.join(ROOT, "templates", "Template_Produk_Warung_300.csv"), "w", encoding="utf-8") as f:
        f.write(text)

    if "`" in text or "${" in text:
        raise SystemExit("Template contains characters that break a JS template literal")
    gs = (
        "/**\n"
        " * KasirWarung AI — TemplateData.gs\n"
        " * 300-item grocery template (generated by tools/build_template.py — do not edit by hand).\n"
        " * Prices are per unit; bundle/wholesale prices apply when qty >= bundle_qty / wholesale_qty.\n"
        " * Stock is 0: record real stock with Stok Masuk or edit the CSV before importing.\n"
        " *\n"
        " * © 2026 KasirWarung AI · Made by Piyu\n"
        " */\n\n"
        "const GROCERY_TEMPLATE_CSV = `" + text + "`;\n"
    )
    with open(os.path.join(ROOT, "src", "TemplateData.gs"), "w", encoding="utf-8") as f:
        f.write(gs)
    print("OK: %d items" % len(rows))


if __name__ == "__main__":
    main()
