# Spot Trading Page — Tier-1 Audit & Design

## 1. Current State Audit

### Jo hai (already implemented)
- **Layout**: Header + Chart (65%) + Right column (Orderbook, Recent Trades, Order Entry) + Bottom (Open Orders, Order History, Trade History)
- **TradingView Chart**: BINANCE symbol mapping, dark theme, 60m interval
- **Orderbook**: Backend API + WebSocket, click to set price/qty
- **Recent Trades**: WS + API, side-colored, click to set price/qty
- **Order Entry**: Buy/Sell, Limit/Market, Price, Qty, Total, Max, place order (backend)
- **Open Orders / Order History / Trade History**: Backend APIs, cancel
- **Default symbol**: URL ?symbol= else first active market, router.replace
- **Public market data**: fetchMarkets, fetchTicker, fetchOrderbook use skipAuth: true

### Price / stats source (current)
- **Header last price & 24h change**: CoinGecko (`useReferencePrice`)
- **Header 24h High / Low**: Backend ticker (`ticker.high_24h`, `ticker.low_24h`)
- **Order total / validation**: CoinGecko ref price (market) ya user price (limit)

### Gaps vs Tier-1 (Binance / Bybit / OKX style)
| Feature | Current | Tier-1 expectation |
|--------|---------|--------------------|
| 24h Volume | Missing in header | Header me 24h Vol visible |
| Price source clarity | CoinGecko + backend mix | Ek primary source (apna ticker) + optional reference |
| Chart height | Fixed 500px | Flexible / full area |
| Orderbook depth bar | None | Bid/ask row pe depth bar (optional) |
| Spread | Not shown | Orderbook ke neeche spread |
| Pair selector on page | Only via Markets link | Header me dropdown/selector |
| Fee display | Not in order entry | Maker/Taker % in order form |
| 24h Change source | CoinGecko | Apna ticker agar backend me change de |

---

## 2. Price / Market Data Options (sirf display ke liye)

Trading, orderbook, volume **apna hi** rahega. Price **display** ke liye options:

1. **Backend ticker only (recommended primary)**  
   - Source: `GET /api/v1/spot/ticker/:symbol`  
   - Milta hai: `last_price`, `volume_24h`, `high_24h`, `low_24h` (backend already de raha hai)  
   - Pros: Apna data, orderbook/trades se consistent  
   - Cons: 24h % change backend me add karna padega (optional)

2. **CoinGecko (reference / fallback)**  
   - Source: `useReferencePrice(symbol)`  
   - Milta hai: price, usd_24h_change  
   - Pros: 24h change ready, no backend change  
   - Cons: Apna orderbook se thoda alag ho sakta hai

3. **Hybrid (current jaisa, thoda improve)**  
   - Last price: Backend ticker (apna market data)  
   - 24h High/Low/Volume: Backend ticker  
   - 24h Change: Backend agar aaye to wahi, nahi to CoinGecko  
   - Header me small “Reference: CoinGecko” ya “Data: Exchange” label

4. **Future: Aggregated / third-party**  
   - Koi aur market-data provider (e.g. Binance public ticker, CryptoCompare)  
   - Abhi ke scope me zaroori nahi

**Recommendation**: Option 3 — Header me **last price, 24h high, low, volume** backend ticker se; **24h change** backend me aaye to wahi, warna CoinGecko. Trading/orderbook/volume sab apna.

---

## 3. Design / UX Changes (minimal, no refactor)

1. **Header**
   - 24h Volume add karo (backend ticker `volume_24h`)
   - Last price: backend ticker use karo (apna market data); agar ticker load nahi hua to CoinGecko fallback optional
   - 24h change: backend me field aaye to backend, nahi to CoinGecko (current)

2. **DEBUG line**
   - Remove (temporary debug)

3. **Chart**
   - TradingView same; height 500px ya parent ke hisaab se flex (optional improvement)

4. **Orderbook**
   - Spread row already design me hai; data me spread (best ask - best bid) add kar sakte ho
   - Depth bar: optional (design polish)

5. **Order entry**
   - Fee % (maker/taker) show karna: backend se `maker_fee`, `taker_fee` already aate hain (selectedMarket), sirf display add karna

---

## 4. Implementation Checklist

- [x] Ticker type me `volume_24h` add karo (backend already bhejta hai)
- [x] SpotPairHeader me 24h Volume show karo (ticker se)
- [x] Header last price: backend ticker primary (ticker.last_price), fallback CoinGecko
- [x] DEBUG div remove karo
- [x] Order entry me fee % display (already present: makerFeePercent, takerFeePercent)
- [ ] (Optional) Orderbook spread calculate + display
