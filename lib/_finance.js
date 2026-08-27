import crypto from 'node:crypto';

export const COIN_IDR = 10;
export const STARTER_PRODUCTS = [
  { name: 'Canva Premium', type: 'Design 1 Bulan' },
  { name: 'Alight Motion Premium', type: '1 Tahun Acc Seller' }
];

export function ensureWallet(user) {
  user.wallet ||= {};
  const w = user.wallet;
  w.coins = Math.max(0, Math.floor(Number(w.coins) || 0));
  w.totalDepositedIdr = Math.max(0, Math.floor(Number(w.totalDepositedIdr) || 0));
  w.totalSpentIdr = Math.max(0, Math.floor(Number(w.totalSpentIdr) || 0));
  w.totalCashbackIdr = Math.max(0, Math.floor(Number(w.totalCashbackIdr) || 0));
  w.transactions = Array.isArray(w.transactions) ? w.transactions : [];
  w.deposits = Array.isArray(w.deposits) ? w.deposits : [];
  w.cashbackPending = Array.isArray(w.cashbackPending) ? w.cashbackPending : [];
  w.claimedCashback = Array.isArray(w.claimedCashback) ? w.claimedCashback : [];
  w.dailyClaimAt ||= '';
  w.gachaAt ||= '';
  w.firstCoinReceivedAt ||= '';
  w.starterOfferUsed = Array.isArray(w.starterOfferUsed) ? w.starterOfferUsed : [];
  return w;
}

export function randomSn(prefix='REGISTRY') {
  return `RYY-STORE/${prefix}-SN${crypto.randomInt(10000000000, 99999999999)}`;
}

export function addWalletTransaction(user, tx) {
  const w = ensureWallet(user);
  w.transactions.unshift({ id:`wallet_${crypto.randomUUID()}`, createdAt:new Date().toISOString(), ...tx });
  w.transactions = w.transactions.slice(0, 200);
  return w.transactions[0];
}

export function creditCoins(user, coins, reason, meta={}) {
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  if (!amount) return { coins:0, balance:ensureWallet(user).coins };
  const w = ensureWallet(user);
  w.coins += amount;
  if (!w.firstCoinReceivedAt) {
    w.firstCoinReceivedAt = new Date().toISOString();
    w.starterOfferUnlockedAt = w.firstCoinReceivedAt;
  }
  addWalletTransaction(user, { type:'credit', coins:amount, idr:amount*COIN_IDR, reason, ...meta });
  return { coins:amount, balance:w.coins };
}

export function debitCoins(user, coins, reason, meta={}) {
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  const w = ensureWallet(user);
  if (w.coins < amount) throw new Error(`Saldo koin tidak cukup. Dibutuhkan ${amount} koin, saldo kamu ${w.coins} koin.`);
  w.coins -= amount;
  w.totalSpentIdr += amount * COIN_IDR;
  addWalletTransaction(user, { type:'debit', coins:amount, idr:amount*COIN_IDR, reason, ...meta });
  return { coins:amount, balance:w.coins };
}

export function refundCoins(user, coins, reason, meta={}) {
  const amount = Math.max(0, Math.floor(Number(coins) || 0));
  if (!amount) return;
  const w = ensureWallet(user);
  w.coins += amount;
  w.totalSpentIdr = Math.max(0, w.totalSpentIdr - amount * COIN_IDR);
  addWalletTransaction(user, { type:'refund', coins:amount, idr:amount*COIN_IDR, reason, ...meta });
}

export function starterOfferEligible(user, productName, typeName) {
  const w = ensureWallet(user);
  if (!w.firstCoinReceivedAt) return false;
  if (!STARTER_PRODUCTS.some(x=>x.name===productName && x.type===typeName)) return false;
  return !w.starterOfferUsed.some(x=>x.name===productName && x.type===typeName);
}

export function markStarterOfferUsed(user, productName, typeName, purchaseId) {
  const w = ensureWallet(user);
  if (!w.starterOfferUsed.some(x=>x.name===productName && x.type===typeName)) {
    w.starterOfferUsed.push({ name:productName, type:typeName, purchaseId, usedAt:new Date().toISOString() });
  }
}

export function unmarkStarterOffer(user, productName, typeName, purchaseId) {
  const w = ensureWallet(user);
  w.starterOfferUsed = w.starterOfferUsed.filter(x=>!(x.name===productName && x.type===typeName && x.purchaseId===purchaseId));
}

export function safeWallet(user) {
  const w=ensureWallet(user);
  return {
    coins:w.coins,
    idrValue:w.coins*COIN_IDR,
    totalDepositedIdr:w.totalDepositedIdr,
    totalSpentIdr:w.totalSpentIdr,
    totalCashbackIdr:w.totalCashbackIdr,
    firstCoinReceivedAt:w.firstCoinReceivedAt,
    dailyClaimAt:w.dailyClaimAt,
    gachaAt:w.gachaAt,
    cashbackPending:w.cashbackPending.map(x=>({...x})),
    transactions:w.transactions.slice(0,100),
    deposits:w.deposits.slice(0,30)
  };
}
