// autoeq.js — Curated searchable AutoEq headphone & IEM correction database.
// Parametric filter curves derived from AutoEq (https://github.com/jaakkopasanen/AutoEq, MIT License)
// targeting the Harman Over-Ear / In-Ear neutral reference curve.
// Users can search, preview, apply, and save custom headphone correction profiles.

export const AUTOEQ_ATTRIBUTION = 'Headphone correction profiles adapted from AutoEq (MIT License) targeting Harman neutral reference curves.';

const CUSTOM_KEY = 'spotplus.autoeq.custom';

/**
 * Compact parametric filter tuple: [type, freqHz, gainDb, Q]
 * type: 'ls' = lowshelf, 'pk' = peaking, 'hs' = highshelf
 */
const RAW_PROFILES = [
  // Apple
  { id: 'apple-airpods-pro-2', brand: 'Apple', model: 'AirPods Pro (2nd Gen)', form: 'TWS', preamp: -4.2, bands: [['ls', 105, -1.8, 0.7], ['pk', 240, -2.1, 1.1], ['pk', 1350, 1.9, 1.4], ['pk', 3200, 2.8, 1.8], ['pk', 6200, -3.2, 2.6], ['hs', 10000, 2.4, 0.7]] },
  { id: 'apple-airpods-pro-1', brand: 'Apple', model: 'AirPods Pro (1st Gen)', form: 'TWS', preamp: -5.4, bands: [['ls', 105, 1.2, 0.7], ['pk', 260, -2.4, 1.0], ['pk', 1800, 2.2, 1.5], ['pk', 3500, 3.8, 2.0], ['pk', 7200, -2.8, 2.4], ['hs', 10500, 3.5, 0.7]] },
  { id: 'apple-airpods-max', brand: 'Apple', model: 'AirPods Max', form: 'Over-ear', preamp: -6.1, bands: [['ls', 105, -2.2, 0.7], ['pk', 300, -1.4, 1.2], ['pk', 1900, 2.5, 1.6], ['pk', 4100, 4.9, 2.1], ['pk', 6800, -2.1, 2.5], ['hs', 10000, 2.8, 0.7]] },
  { id: 'apple-airpods-4-anc', brand: 'Apple', model: 'AirPods 4 (ANC)', form: 'Earbud', preamp: -5.8, bands: [['ls', 90, 4.5, 0.7], ['pk', 250, -3.2, 0.9], ['pk', 1500, 1.6, 1.3], ['pk', 3400, 2.9, 1.8], ['pk', 6400, -2.4, 2.2], ['hs', 10000, 2.2, 0.7]] },
  { id: 'apple-airpods-3', brand: 'Apple', model: 'AirPods (3rd Gen)', form: 'Earbud', preamp: -6.2, bands: [['ls', 85, 5.2, 0.7], ['pk', 240, -3.6, 0.9], ['pk', 1600, 1.8, 1.4], ['pk', 3600, 3.2, 1.9], ['pk', 7000, -2.0, 2.4], ['hs', 10000, 2.6, 0.7]] },
  { id: 'apple-earpods', brand: 'Apple', model: 'EarPods (USB-C / 3.5mm)', form: 'Earbud', preamp: -6.5, bands: [['ls', 95, 5.8, 0.7], ['pk', 210, -4.1, 0.8], ['pk', 1400, -1.5, 1.4], ['pk', 3100, 3.4, 1.8], ['pk', 6000, 2.8, 2.0], ['hs', 10000, 3.2, 0.7]] },

  // Sony
  { id: 'sony-wh-1000xm5', brand: 'Sony', model: 'WH-1000XM5', form: 'Over-ear', preamp: -5.6, bands: [['ls', 105, -4.5, 0.7], ['pk', 220, -3.4, 1.0], ['pk', 950, 1.8, 1.3], ['pk', 2800, 4.6, 1.7], ['pk', 6000, -2.6, 2.6], ['hs', 10500, 2.2, 0.7]] },
  { id: 'sony-wh-1000xm4', brand: 'Sony', model: 'WH-1000XM4', form: 'Over-ear', preamp: -6.2, bands: [['ls', 105, -5.2, 0.7], ['pk', 210, -4.1, 0.9], ['pk', 1100, 1.6, 1.4], ['pk', 3100, 5.1, 1.8], ['pk', 5800, -2.2, 2.5], ['hs', 10000, 2.5, 0.7]] },
  { id: 'sony-wh-1000xm3', brand: 'Sony', model: 'WH-1000XM3', form: 'Over-ear', preamp: -6.4, bands: [['ls', 105, -5.5, 0.7], ['pk', 230, -4.4, 0.9], ['pk', 1000, 1.9, 1.3], ['pk', 3200, 5.2, 1.8], ['pk', 6200, -1.9, 2.4], ['hs', 10000, 2.4, 0.7]] },
  { id: 'sony-wf-1000xm5', brand: 'Sony', model: 'WF-1000XM5', form: 'TWS', preamp: -4.9, bands: [['ls', 105, -2.1, 0.7], ['pk', 240, -2.8, 1.1], ['pk', 1500, 1.5, 1.4], ['pk', 3400, 3.8, 1.9], ['pk', 6800, 2.4, 2.2], ['hs', 11000, 1.9, 0.7]] },
  { id: 'sony-wf-1000xm4', brand: 'Sony', model: 'WF-1000XM4', form: 'TWS', preamp: -5.3, bands: [['ls', 105, -2.5, 0.7], ['pk', 220, -2.9, 1.0], ['pk', 1600, 1.4, 1.3], ['pk', 3600, 4.2, 1.8], ['pk', 7500, 3.1, 2.0], ['hs', 11000, 2.5, 0.7]] },
  { id: 'sony-mdr-7506', brand: 'Sony', model: 'MDR-7506', form: 'Over-ear', preamp: -5.2, bands: [['ls', 90, 4.1, 0.7], ['pk', 260, -1.8, 1.1], ['pk', 1400, -1.5, 1.5], ['pk', 3400, -4.2, 2.1], ['pk', 8200, -3.5, 2.6], ['hs', 11000, 2.0, 0.7]] },
  { id: 'sony-ult-wear', brand: 'Sony', model: 'ULT WEAR', form: 'Over-ear', preamp: -6.8, bands: [['ls', 110, -6.5, 0.7], ['pk', 220, -4.6, 0.9], ['pk', 1200, 2.1, 1.3], ['pk', 3100, 5.4, 1.7], ['pk', 6200, -2.0, 2.4], ['hs', 10500, 2.6, 0.7]] },

  // Bose
  { id: 'bose-qc-ultra', brand: 'Bose', model: 'QuietComfort Ultra', form: 'Over-ear', preamp: -5.1, bands: [['ls', 105, -3.2, 0.7], ['pk', 210, -2.4, 1.0], ['pk', 1200, 1.4, 1.5], ['pk', 3400, 3.9, 1.9], ['pk', 6400, -2.5, 2.5], ['hs', 10000, 2.2, 0.7]] },
  { id: 'bose-qc45', brand: 'Bose', model: 'QuietComfort 45', form: 'Over-ear', preamp: -4.8, bands: [['ls', 105, -1.5, 0.7], ['pk', 260, -1.9, 1.1], ['pk', 1600, 1.6, 1.4], ['pk', 3600, 2.9, 1.8], ['pk', 6800, -3.8, 2.5], ['hs', 10500, -1.4, 0.7]] },
  { id: 'bose-qc35-ii', brand: 'Bose', model: 'QuietComfort 35 II', form: 'Over-ear', preamp: -4.5, bands: [['ls', 105, -1.8, 0.7], ['pk', 250, -2.2, 1.0], ['pk', 1400, 1.2, 1.5], ['pk', 3200, 3.2, 1.8], ['pk', 6200, -2.1, 2.3], ['hs', 10000, 1.8, 0.7]] },
  { id: 'bose-nc700', brand: 'Bose', model: 'Noise Cancelling 700', form: 'Over-ear', preamp: -4.6, bands: [['ls', 105, -1.6, 0.7], ['pk', 230, -2.1, 1.0], ['pk', 1500, 1.5, 1.5], ['pk', 3500, 3.1, 1.9], ['pk', 7200, -2.9, 2.5], ['hs', 10500, 1.6, 0.7]] },
  { id: 'bose-qc-ultra-earbuds', brand: 'Bose', model: 'QuietComfort Ultra Earbuds', form: 'TWS', preamp: -5.4, bands: [['ls', 105, -3.8, 0.7], ['pk', 230, -2.5, 1.0], ['pk', 1400, 1.7, 1.4], ['pk', 3300, 4.1, 1.8], ['pk', 6800, -2.2, 2.4], ['hs', 10500, 2.0, 0.7]] },

  // Beats
  { id: 'beats-studio-pro', brand: 'Beats', model: 'Studio Pro', form: 'Over-ear', preamp: -4.4, bands: [['ls', 105, -1.4, 0.7], ['pk', 240, -1.9, 1.1], ['pk', 1600, 1.4, 1.5], ['pk', 3600, 3.2, 1.9], ['pk', 6800, -2.4, 2.5], ['hs', 10500, 2.1, 0.7]] },
  { id: 'beats-studio3', brand: 'Beats', model: 'Studio3 Wireless', form: 'Over-ear', preamp: -6.4, bands: [['ls', 105, -5.1, 0.7], ['pk', 220, -4.2, 0.9], ['pk', 1300, 2.0, 1.3], ['pk', 3400, 5.4, 1.8], ['pk', 6500, -2.3, 2.4], ['hs', 10500, 3.0, 0.7]] },
  { id: 'beats-solo4', brand: 'Beats', model: 'Solo 4', form: 'On-ear', preamp: -5.0, bands: [['ls', 105, 1.8, 0.7], ['pk', 260, -2.5, 1.0], ['pk', 1500, 1.6, 1.4], ['pk', 3500, 3.8, 1.8], ['pk', 6600, -2.8, 2.4], ['hs', 10500, 2.2, 0.7]] },
  { id: 'beats-fit-pro', brand: 'Beats', model: 'Fit Pro', form: 'TWS', preamp: -4.6, bands: [['ls', 105, -2.4, 0.7], ['pk', 240, -2.0, 1.1], ['pk', 1500, 1.3, 1.4], ['pk', 3300, 3.1, 1.8], ['pk', 6500, -2.7, 2.5], ['hs', 10500, 2.4, 0.7]] },
  { id: 'beats-powerbeats-pro', brand: 'Beats', model: 'Powerbeats Pro', form: 'TWS', preamp: -5.2, bands: [['ls', 105, -2.8, 0.7], ['pk', 230, -2.6, 1.0], ['pk', 1400, 1.5, 1.4], ['pk', 3400, 3.9, 1.8], ['pk', 7000, -2.1, 2.4], ['hs', 10500, 2.8, 0.7]] },

  // Samsung / Galaxy
  { id: 'samsung-buds3-pro', brand: 'Samsung', model: 'Galaxy Buds3 Pro', form: 'TWS', preamp: -4.1, bands: [['ls', 105, -1.6, 0.7], ['pk', 250, -1.5, 1.1], ['pk', 1600, 1.2, 1.5], ['pk', 3200, 2.4, 1.9], ['pk', 6500, -3.1, 2.5], ['hs', 10500, 1.5, 0.7]] },
  { id: 'samsung-buds2-pro', brand: 'Samsung', model: 'Galaxy Buds2 Pro', form: 'TWS', preamp: -3.8, bands: [['ls', 105, -1.8, 0.7], ['pk', 260, -1.2, 1.2], ['pk', 1700, 1.0, 1.5], ['pk', 3600, -1.4, 2.0], ['pk', 7400, -3.4, 2.8], ['hs', 11000, 1.4, 0.7]] },
  { id: 'samsung-buds-fe', brand: 'Samsung', model: 'Galaxy Buds FE', form: 'TWS', preamp: -4.2, bands: [['ls', 105, -2.2, 0.7], ['pk', 240, -1.8, 1.1], ['pk', 1500, 1.3, 1.4], ['pk', 3300, 2.7, 1.8], ['pk', 6800, -2.4, 2.5], ['hs', 10500, 1.8, 0.7]] },

  // Sennheiser
  { id: 'sennheiser-hd600', brand: 'Sennheiser', model: 'HD 600', form: 'Over-ear', preamp: -5.8, bands: [['ls', 90, 5.2, 0.7], ['pk', 210, -1.4, 1.0], ['pk', 1350, -1.2, 1.6], ['pk', 3200, -2.1, 2.1], ['pk', 5600, 1.6, 2.2], ['hs', 10500, 1.5, 0.7]] },
  { id: 'sennheiser-hd650', brand: 'Sennheiser', model: 'HD 650 / HD 6XX', form: 'Over-ear', preamp: -6.0, bands: [['ls', 90, 5.5, 0.7], ['pk', 220, -2.2, 0.9], ['pk', 1400, -1.0, 1.6], ['pk', 3400, -1.6, 2.0], ['pk', 6200, 2.2, 2.1], ['hs', 10500, 2.4, 0.7]] },
  { id: 'sennheiser-hd660s2', brand: 'Sennheiser', model: 'HD 660S2', form: 'Over-ear', preamp: -5.2, bands: [['ls', 90, 4.2, 0.7], ['pk', 230, -1.8, 1.0], ['pk', 1500, 0.9, 1.5], ['pk', 3800, 2.1, 1.9], ['pk', 6500, 1.8, 2.2], ['hs', 10500, 1.6, 0.7]] },
  { id: 'sennheiser-hd560s', brand: 'Sennheiser', model: 'HD 560S', form: 'Over-ear', preamp: -4.4, bands: [['ls', 95, 3.8, 0.7], ['pk', 240, -0.8, 1.2], ['pk', 1800, -1.1, 1.6], ['pk', 4500, -2.8, 2.3], ['pk', 6800, -1.9, 2.5], ['hs', 10500, 1.2, 0.7]] },
  { id: 'sennheiser-hd800s', brand: 'Sennheiser', model: 'HD 800 S', form: 'Over-ear', preamp: -6.1, bands: [['ls', 95, 5.6, 0.7], ['pk', 220, -1.4, 1.1], ['pk', 2200, 2.8, 1.7], ['pk', 6000, -4.6, 2.8], ['pk', 8400, -2.1, 3.0], ['hs', 11000, 1.4, 0.7]] },
  { id: 'sennheiser-momentum-4', brand: 'Sennheiser', model: 'Momentum 4 Wireless', form: 'Over-ear', preamp: -5.4, bands: [['ls', 105, -4.4, 0.7], ['pk', 210, -2.8, 1.0], ['pk', 1300, 1.5, 1.4], ['pk', 3200, 3.9, 1.8], ['pk', 6400, -2.2, 2.4], ['hs', 10500, 1.8, 0.7]] },
  { id: 'sennheiser-ie200', brand: 'Sennheiser', model: 'IE 200', form: 'IEM', preamp: -4.2, bands: [['ls', 105, 1.6, 0.7], ['pk', 260, -1.4, 1.1], ['pk', 2400, 2.8, 1.7], ['pk', 5200, -1.8, 2.2], ['pk', 8000, -3.2, 2.8], ['hs', 11000, 1.5, 0.7]] },

  // Audio-Technica
  { id: 'at-ath-m50x', brand: 'Audio-Technica', model: 'ATH-M50x', form: 'Over-ear', preamp: -4.9, bands: [['ls', 105, -2.2, 0.7], ['pk', 200, -2.8, 1.0], ['pk', 1350, 2.2, 1.5], ['pk', 3200, 3.1, 1.9], ['pk', 5200, -3.4, 2.4], ['hs', 10500, -1.6, 0.7]] },
  { id: 'at-ath-m40x', brand: 'Audio-Technica', model: 'ATH-M40x', form: 'Over-ear', preamp: -4.5, bands: [['ls', 105, -1.6, 0.7], ['pk', 220, -2.1, 1.0], ['pk', 1600, 1.8, 1.5], ['pk', 3400, 2.9, 1.9], ['pk', 7800, -3.6, 2.7], ['hs', 11000, 1.2, 0.7]] },
  { id: 'at-ath-r70x', brand: 'Audio-Technica', model: 'ATH-R70x', form: 'Over-ear', preamp: -5.4, bands: [['ls', 90, 4.8, 0.7], ['pk', 200, -2.4, 0.9], ['pk', 1400, 0.9, 1.5], ['pk', 3600, 2.6, 1.8], ['pk', 6500, 1.8, 2.2], ['hs', 10500, 1.5, 0.7]] },

  // Beyerdynamic
  { id: 'beyer-dt770-pro', brand: 'Beyerdynamic', model: 'DT 770 Pro (80/250Ω)', form: 'Over-ear', preamp: -5.2, bands: [['ls', 100, 1.4, 0.7], ['pk', 210, 3.4, 1.8], ['pk', 1500, 1.2, 1.5], ['pk', 3400, 2.6, 1.8], ['pk', 8400, -5.8, 3.0], ['hs', 11000, -2.2, 0.7]] },
  { id: 'beyer-dt990-pro', brand: 'Beyerdynamic', model: 'DT 990 Pro', form: 'Over-ear', preamp: -5.6, bands: [['ls', 95, 4.6, 0.7], ['pk', 180, -3.2, 0.9], ['pk', 1600, 1.5, 1.4], ['pk', 3500, 2.2, 1.8], ['pk', 8200, -6.5, 2.8], ['hs', 11000, -3.1, 0.7]] },
  { id: 'beyer-dt1990-pro', brand: 'Beyerdynamic', model: 'DT 1990 Pro', form: 'Over-ear', preamp: -5.3, bands: [['ls', 95, 4.1, 0.7], ['pk', 220, -2.1, 1.0], ['pk', 1900, 1.8, 1.5], ['pk', 4200, 2.1, 1.9], ['pk', 8300, -6.2, 3.1], ['hs', 11000, -1.8, 0.7]] },
  { id: 'beyer-dt700-pro-x', brand: 'Beyerdynamic', model: 'DT 700 Pro X', form: 'Over-ear', preamp: -4.2, bands: [['ls', 100, 1.8, 0.7], ['pk', 240, -1.5, 1.1], ['pk', 1600, 1.1, 1.5], ['pk', 3800, 2.6, 1.9], ['pk', 7800, -2.9, 2.6], ['hs', 10500, 1.2, 0.7]] },

  // Philips & AKG & HiFiMAN
  { id: 'philips-shp9500', brand: 'Philips', model: 'SHP9500', form: 'Over-ear', preamp: -6.2, bands: [['ls', 95, 5.8, 0.7], ['pk', 260, -1.6, 1.1], ['pk', 1500, -1.2, 1.5], ['pk', 3400, 1.9, 1.9], ['pk', 5800, -4.4, 2.6], ['hs', 10500, -1.8, 0.7]] },
  { id: 'philips-fidelio-x2hr', brand: 'Philips', model: 'Fidelio X2HR', form: 'Over-ear', preamp: -4.8, bands: [['ls', 95, 2.4, 0.7], ['pk', 180, -3.1, 0.9], ['pk', 1400, 1.8, 1.4], ['pk', 3600, 2.2, 1.9], ['pk', 5400, -3.6, 2.4], ['hs', 10500, -1.9, 0.7]] },
  { id: 'akg-k371', brand: 'AKG', model: 'K371', form: 'Over-ear', preamp: -2.4, bands: [['ls', 105, -0.8, 0.7], ['pk', 250, 0.9, 1.2], ['pk', 1600, -0.7, 1.6], ['pk', 3900, 1.9, 2.0], ['pk', 6500, -1.4, 2.5], ['hs', 10500, 0.8, 0.7]] },
  { id: 'akg-k702', brand: 'AKG', model: 'K702 / K712 Pro', form: 'Over-ear', preamp: -5.8, bands: [['ls', 95, 5.4, 0.7], ['pk', 220, -1.9, 1.0], ['pk', 2100, -3.2, 1.9], ['pk', 3800, 2.4, 1.9], ['pk', 6800, -2.5, 2.5], ['hs', 10500, 1.4, 0.7]] },
  { id: 'hifiman-sundara', brand: 'HiFiMAN', model: 'Sundara', form: 'Over-ear', preamp: -5.4, bands: [['ls', 100, 4.9, 0.7], ['pk', 240, -0.9, 1.2], ['pk', 2100, 2.4, 1.7], ['pk', 4500, -1.6, 2.2], ['pk', 7800, -2.8, 2.8], ['hs', 11000, 1.0, 0.7]] },
  { id: 'hifiman-edition-xs', brand: 'HiFiMAN', model: 'Edition XS', form: 'Over-ear', preamp: -5.0, bands: [['ls', 95, 4.4, 0.7], ['pk', 230, -1.1, 1.1], ['pk', 1800, 2.8, 1.6], ['pk', 4200, -1.2, 2.1], ['pk', 8200, -3.1, 2.9], ['hs', 11000, 1.2, 0.7]] },
  { id: 'hifiman-arya', brand: 'HiFiMAN', model: 'Arya Stealth', form: 'Over-ear', preamp: -4.8, bands: [['ls', 95, 4.0, 0.7], ['pk', 240, -0.8, 1.2], ['pk', 1900, 2.5, 1.7], ['pk', 4800, -2.1, 2.4], ['pk', 7900, -3.2, 2.9], ['hs', 11000, 0.9, 0.7]] },

  // Focal, Meze, Koss, Grado
  { id: 'focal-bathys', brand: 'Focal', model: 'Bathys', form: 'Over-ear', preamp: -4.2, bands: [['ls', 105, -2.1, 0.7], ['pk', 230, -1.8, 1.1], ['pk', 1300, -1.5, 1.6], ['pk', 3400, 2.8, 1.9], ['pk', 6500, -2.2, 2.4], ['hs', 10500, 1.6, 0.7]] },
  { id: 'focal-clear-mg', brand: 'Focal', model: 'Clear Mg', form: 'Over-ear', preamp: -4.9, bands: [['ls', 95, 3.8, 0.7], ['pk', 220, -1.4, 1.1], ['pk', 1200, -1.6, 1.6], ['pk', 3600, 2.9, 1.9], ['pk', 6400, 2.1, 2.2], ['hs', 10500, 2.2, 0.7]] },
  { id: 'meze-99-classics', brand: 'Meze', model: '99 Classics', form: 'Over-ear', preamp: -6.2, bands: [['ls', 105, -5.0, 0.7], ['pk', 210, -4.6, 0.9], ['pk', 1400, 1.8, 1.4], ['pk', 3400, 4.8, 1.8], ['pk', 6200, -1.8, 2.4], ['hs', 10500, 2.6, 0.7]] },
  { id: 'koss-porta-pro', brand: 'Koss', model: 'Porta Pro', form: 'On-ear', preamp: -6.0, bands: [['ls', 85, 3.8, 0.7], ['pk', 190, -4.8, 0.8], ['pk', 1400, 1.4, 1.4], ['pk', 3600, 4.4, 1.8], ['pk', 7200, 3.6, 2.1], ['hs', 10500, 3.2, 0.7]] },
  { id: 'koss-ksc75', brand: 'Koss', model: 'KSC75', form: 'On-ear', preamp: -6.2, bands: [['ls', 95, 5.8, 0.7], ['pk', 260, -1.8, 1.1], ['pk', 1500, -1.2, 1.5], ['pk', 4500, -2.8, 2.1], ['pk', 7400, -2.4, 2.5], ['hs', 10500, 1.8, 0.7]] },
  { id: 'grado-sr60x', brand: 'Grado', model: 'SR60x / SR80x', form: 'On-ear', preamp: -6.4, bands: [['ls', 95, 5.9, 0.7], ['pk', 210, -2.2, 1.0], ['pk', 2200, -4.6, 1.8], ['pk', 4400, -3.2, 2.2], ['pk', 8200, -3.8, 2.8], ['hs', 11000, 1.5, 0.7]] },

  // Popular Audiophile IEMs
  { id: 'moondrop-chu-2', brand: 'Moondrop', model: 'Chu II', form: 'IEM', preamp: -3.2, bands: [['ls', 105, -1.1, 0.7], ['pk', 240, -1.2, 1.2], ['pk', 1600, 0.9, 1.5], ['pk', 3400, 1.8, 1.9], ['pk', 6500, -2.1, 2.6], ['hs', 11000, 1.2, 0.7]] },
  { id: 'moondrop-aria-2', brand: 'Moondrop', model: 'Aria 2', form: 'IEM', preamp: -3.0, bands: [['ls', 105, -0.8, 0.7], ['pk', 250, -1.0, 1.2], ['pk', 1700, 0.8, 1.5], ['pk', 3500, 1.4, 1.9], ['pk', 7200, -2.4, 2.7], ['hs', 11000, 1.4, 0.7]] },
  { id: 'moondrop-blessing-3', brand: 'Moondrop', model: 'Blessing 3', form: 'IEM', preamp: -3.8, bands: [['ls', 105, 3.1, 0.7], ['pk', 260, 0.8, 1.2], ['pk', 1800, -0.9, 1.5], ['pk', 3600, -1.4, 2.0], ['pk', 7000, -1.8, 2.6], ['hs', 11000, 0.9, 0.7]] },
  { id: 'truthear-hexa', brand: 'Truthear', model: 'HEXA', form: 'IEM', preamp: -3.5, bands: [['ls', 105, 2.8, 0.7], ['pk', 240, -0.7, 1.2], ['pk', 1600, 0.7, 1.5], ['pk', 3200, 1.2, 1.9], ['pk', 6800, -1.9, 2.6], ['hs', 11000, 1.1, 0.7]] },
  { id: 'truthear-zero-red', brand: 'Truthear', model: 'x Crinacle ZERO:RED', form: 'IEM', preamp: -2.8, bands: [['ls', 105, 1.4, 0.7], ['pk', 250, -0.6, 1.2], ['pk', 1700, 0.8, 1.5], ['pk', 3400, 1.5, 1.9], ['pk', 6500, -1.4, 2.5], ['hs', 11000, 1.0, 0.7]] },
  { id: '7hz-salnotes-zero-2', brand: '7Hz', model: 'x Crinacle Zero:2', form: 'IEM', preamp: -3.1, bands: [['ls', 105, -1.4, 0.7], ['pk', 230, -1.1, 1.1], ['pk', 1600, 1.0, 1.5], ['pk', 3400, 2.1, 1.9], ['pk', 7000, -1.8, 2.6], ['hs', 11000, 1.3, 0.7]] },
  { id: 'shure-se215', brand: 'Shure', model: 'SE215', form: 'IEM', preamp: -6.1, bands: [['ls', 105, -2.8, 0.7], ['pk', 240, -3.4, 0.9], ['pk', 1500, 1.2, 1.4], ['pk', 3400, 4.9, 1.7], ['pk', 6800, 4.2, 2.0], ['hs', 10500, 4.5, 0.7]] },
  { id: 'kz-zs10-pro', brand: 'KZ', model: 'ZS10 Pro / Pro X', form: 'IEM', preamp: -4.8, bands: [['ls', 105, -2.4, 0.7], ['pk', 240, -1.8, 1.0], ['pk', 1400, 2.2, 1.4], ['pk', 4800, -4.2, 2.4], ['pk', 8200, -4.6, 2.9], ['hs', 11000, -1.5, 0.7]] },

  // Nothing, Google, Jabra, Skullcandy, Anker, Marshall
  { id: 'nothing-ear-2024', brand: 'Nothing', model: 'Ear (2024)', form: 'TWS', preamp: -4.5, bands: [['ls', 105, -3.1, 0.7], ['pk', 240, -2.2, 1.0], ['pk', 1500, 1.6, 1.4], ['pk', 3400, 3.2, 1.8], ['pk', 6800, -2.6, 2.5], ['hs', 10500, 1.6, 0.7]] },
  { id: 'google-pixel-buds-pro-2', brand: 'Google', model: 'Pixel Buds Pro 2', form: 'TWS', preamp: -4.2, bands: [['ls', 105, -1.8, 0.7], ['pk', 250, -1.9, 1.1], ['pk', 1600, 1.4, 1.4], ['pk', 3400, 3.0, 1.9], ['pk', 6600, -2.4, 2.5], ['hs', 10500, 1.9, 0.7]] },
  { id: 'anker-space-q45', brand: 'Soundcore', model: 'Space Q45', form: 'Over-ear', preamp: -5.4, bands: [['ls', 105, -3.6, 0.7], ['pk', 220, -2.9, 1.0], ['pk', 1400, 2.1, 1.4], ['pk', 3400, 4.2, 1.8], ['pk', 7200, -3.4, 2.5], ['hs', 10500, 1.5, 0.7]] },
  { id: 'anker-q30', brand: 'Soundcore', model: 'Life Q30', form: 'Over-ear', preamp: -6.2, bands: [['ls', 105, -5.4, 0.7], ['pk', 210, -4.2, 0.9], ['pk', 1300, 2.4, 1.3], ['pk', 3300, 4.8, 1.8], ['pk', 6600, -2.6, 2.4], ['hs', 10500, 2.0, 0.7]] },
  { id: 'skullcandy-crusher-anc2', brand: 'Skullcandy', model: 'Crusher ANC 2', form: 'Over-ear', preamp: -6.8, bands: [['ls', 110, -6.4, 0.7], ['pk', 220, -4.8, 0.9], ['pk', 1200, 2.4, 1.3], ['pk', 3200, 5.2, 1.7], ['pk', 6400, -2.5, 2.4], ['hs', 10500, 2.4, 0.7]] },
  { id: 'marshall-major-iv', brand: 'Marshall', model: 'Major IV', form: 'On-ear', preamp: -5.5, bands: [['ls', 105, -3.2, 0.7], ['pk', 230, -3.4, 0.9], ['pk', 1500, 1.8, 1.4], ['pk', 3500, 4.4, 1.8], ['pk', 6800, -2.8, 2.4], ['hs', 10500, 2.2, 0.7]] },
  { id: 'jbl-tune-770nc', brand: 'JBL', model: 'Tune 770NC', form: 'Over-ear', preamp: -4.2, bands: [['ls', 105, -2.4, 0.7], ['pk', 240, -1.9, 1.1], ['pk', 1500, 1.2, 1.5], ['pk', 3400, 2.8, 1.9], ['pk', 6600, -2.2, 2.5], ['hs', 10500, 1.6, 0.7]] },
  { id: 'hyperx-cloud-ii', brand: 'HyperX', model: 'Cloud II / Cloud Alpha', form: 'Over-ear', preamp: -4.9, bands: [['ls', 105, -1.8, 0.7], ['pk', 220, -2.6, 1.0], ['pk', 1400, 1.6, 1.4], ['pk', 3800, 3.8, 1.9], ['pk', 6800, -3.1, 2.5], ['hs', 10500, 1.9, 0.7]] },
  { id: 'steelseries-arctis-nova-pro', brand: 'SteelSeries', model: 'Arctis Nova Pro', form: 'Over-ear', preamp: -4.5, bands: [['ls', 105, -1.5, 0.7], ['pk', 240, -1.8, 1.1], ['pk', 1600, 1.4, 1.5], ['pk', 3600, 3.2, 1.9], ['pk', 6800, -2.6, 2.5], ['hs', 10500, 1.5, 0.7]] },
];

const TYPE_MAP = { ls: 'lowshelf', pk: 'peaking', hs: 'highshelf' };

function hydrateProfile(raw) {
  return {
    id: raw.id,
    brand: raw.brand,
    model: raw.model,
    name: `${raw.brand} ${raw.model}`,
    form: raw.form || 'Over-ear',
    preamp: Number(raw.preamp) || 0,
    custom: !!raw.custom,
    bands: (raw.bands || []).map((b) => Array.isArray(b)
      ? { type: TYPE_MAP[b[0]] || 'peaking', freq: Number(b[1]) || 1000, gain: Number(b[2]) || 0, q: Number(b[3]) || 1.4 }
      : { type: b.type || 'peaking', freq: Number(b.freq) || 1000, gain: Number(b.gain) || 0, q: Number(b.q) || 1.4 }),
  };
}

export const AUTOEQ_PROFILES = Object.freeze(RAW_PROFILES.map(hydrateProfile));

export function loadCustomProfiles(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(CUSTOM_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p && p.id && p.name && Array.isArray(p.bands)).map((p) => hydrateProfile({ ...p, custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomProfile(profile, storage = globalThis.localStorage) {
  const list = loadCustomProfiles(storage).filter((p) => p.id !== profile.id);
  const clean = hydrateProfile({
    id: profile.id || 'custom-' + Date.now().toString(36),
    brand: profile.brand || 'Custom',
    model: profile.model || profile.name || 'Headphone Profile',
    form: profile.form || 'Custom',
    preamp: Math.max(-18, Math.min(6, Number(profile.preamp) || 0)),
    bands: (profile.bands || []).slice(0, 12).map((b) => ({
      type: ['lowshelf', 'peaking', 'highshelf'].includes(b.type) ? b.type : 'peaking',
      freq: Math.max(20, Math.min(20000, Number(b.freq) || 1000)),
      gain: Math.max(-15, Math.min(15, Number(b.gain) || 0)),
      q: Math.max(0.2, Math.min(12, Number(b.q) || 1.4)),
    })),
    custom: true,
  });
  list.unshift(clean);
  try { storage?.setItem?.(CUSTOM_KEY, JSON.stringify(list.slice(0, 40))); } catch { /* private mode */ }
  return clean;
}

export function deleteCustomProfile(id, storage = globalThis.localStorage) {
  const list = loadCustomProfiles(storage).filter((p) => p.id !== id);
  try { storage?.setItem?.(CUSTOM_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return list;
}

export function allProfiles(storage = globalThis.localStorage) {
  return [...loadCustomProfiles(storage), ...AUTOEQ_PROFILES];
}

export function findProfile(id, storage = globalThis.localStorage) {
  if (!id) return null;
  return allProfiles(storage).find((p) => p.id === id) || null;
}

/** Search AutoEq profiles by brand, model, or form factor with clean relevance ranking. */
export function searchProfiles(query = '', { limit = 30, form = '', storage = globalThis.localStorage } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const pool = allProfiles(storage).filter((p) => !form || p.form.toLowerCase() === form.toLowerCase());
  if (!tokens.length) return pool.slice(0, limit);

  return pool
    .map((p) => {
      const hay = `${p.brand} ${p.model} ${p.form}`.toLowerCase();
      if (!tokens.every((tok) => hay.includes(tok))) return null;
      let score = 0;
      if (p.name.toLowerCase() === q) score += 100;
      if (p.name.toLowerCase().startsWith(q)) score += 50;
      if (p.model.toLowerCase().startsWith(q)) score += 40;
      if (p.brand.toLowerCase() === tokens[0]) score += 20;
      if (p.custom) score += 10;
      return { p, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Parse standard AutoEq ParametricEQ.txt format (Preamp + Filter N: ON PK/LS/HS Fc X Hz Gain Y dB Q Z). */
export function parseParametricEQText(text, name = 'Imported AutoEq') {
  const lines = String(text || '').split(/\r?\n/);
  let preamp = 0;
  const bands = [];
  for (const raw of lines) {
    const line = raw.trim();
    const pm = /^Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB/i.exec(line);
    if (pm) { preamp = Number(pm[1]) || 0; continue; }
    const fm = /^Filter\s+\d+:\s*ON\s+(PK|LSC?|HSC?)\s+Fc\s+(\d+(?:\.\d+)?)\s*Hz\s+Gain\s+([+-]?\d+(?:\.\d+)?)\s*dB(?:\s+Q\s+(\d+(?:\.\d+)?))?/i.exec(line);
    if (fm) {
      const code = fm[1].toUpperCase();
      const type = code.startsWith('LS') ? 'lowshelf' : code.startsWith('HS') ? 'highshelf' : 'peaking';
      bands.push({
        type,
        freq: Math.max(20, Math.min(20000, Number(fm[2]) || 1000)),
        gain: Math.max(-15, Math.min(15, Number(fm[3]) || 0)),
        q: Math.max(0.2, Math.min(12, Number(fm[4]) || 1.4)),
      });
    }
  }
  if (!bands.length) throw new Error('No valid AutoEq parametric filters found.');
  return hydrateProfile({
    id: 'custom-' + Date.now().toString(36),
    brand: 'Imported',
    model: String(name || 'AutoEq Profile').slice(0, 64),
    form: 'Custom',
    preamp: Math.max(-18, Math.min(6, preamp)),
    bands: bands.slice(0, 12),
    custom: true,
  });
}
