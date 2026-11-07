-- Zuordnung Produkt → Teams-Kanäle. Ohne Eintrag gehen Meldungen an alle aktiven Kanäle.
CREATE TABLE product_channels (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, channel_id)
);
