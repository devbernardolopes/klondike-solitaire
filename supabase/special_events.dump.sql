-- ============================================================
-- Catalog dump — generated 2026-09-08T00:58:52.443Z
-- Source of truth for scripts/i18n-sync.mjs. Do not edit by hand.
-- Re-run `npm run catalog:dump` after any dashboard edits.
-- Idempotent: safe to paste into Supabase SQL editor and re-run.
-- ============================================================
INSERT INTO public.special_events (id, title, description) VALUES
  ('day-of-the-dead-2026', 'Day of the Dead', 'Día de los Muertos is a vibrant Mexican tradition that honors deceased loved ones with colorful ofrendas, marigolds, sugar skulls, and festive gatherings that celebrate life and memory.'),
  ('dragon-boat-festival-2026', 'Dragon Boat Festival 2026', 'The Dragon Boat Festival commemorates the poet Qu Yuan with competitive dragon boat races, sticky rice dumplings (zongzi), and traditional rituals across China and East Asian communities.'),
  ('festival-of-san-fermin-2026', 'Festival of San Fermín 2026', 'The Festival of San Fermín in Pamplona, Spain, features the famous running of the bulls, traditional processions, and festive gatherings from 6 to 14 July.'),
  ('festivus-2025', 'Festivus 2025', 'Festivus is the secular, anti-commercial holiday popularized by the television series Seinfeld, featuring the aluminum Festivus pole, the airing of grievances, and feats of strength, observed on 23 December.'),
  ('independence-day-2026', 'Independence Day', 'Independence Day commemorates the adoption of the Declaration of Independence with fireworks, patriotic displays, family gatherings, and celebrations of American freedom and history.'),
  ('japanese-cherry-blossom-2026', 'Japanese Cherry Blossom Season 2026', 'The Japanese Cherry Blossom Season, known as Sakura, celebrates the fleeting beauty of blooming cherry trees with hanami gatherings, picnics under the blossoms, and traditional spring festivities across Japan.'),
  ('la-tomatina-2026', 'La Tomatina', 'La Tomatina is the famous Spanish tomato-throwing festival held in Buñol, where participants engage in a massive, joyful food fight that fills the streets with red pulp and laughter.'),
  ('onam-2026', 'Onam 2026', 'Onam is the major harvest festival of Kerala, marked by intricate floral rangoli (pookalam), traditional boat races, elaborate feasts, and cultural performances that welcome the legendary King Mahabali.'),
  ('st-patricks-day-2026', 'St. Patrick''s Day', 'St. Patrick''s Day commemorates Ireland''s patron saint with parades, green attire, traditional music, and festive gatherings that celebrate Irish heritage and culture worldwide.'),
  ('swedish-midsommar-2026', 'Swedish Midsommar 2026', 'Swedish Midsommar 2026 marks the traditional Midsummer celebration with maypoles, floral crowns, outdoor dances, and gatherings under the long Nordic summer light around the solstice.'),
  ('talk-like-a-pirate-day-2025', 'Talk Like a Pirate Day 2025', 'Talk Like a Pirate Day is a light-hearted annual observance that encourages playful pirate speech, nautical costumes, and spirited fun in celebration of pirate lore and adventure.'),
  ('test-event-2026', 'Test Event 2026', 'Tolkien Day honors the life and works of J. R. R. Tolkien, inviting readers to explore the rich landscapes, languages, and epic tales of Middle-earth through literature and shared appreciation.'),
  ('tolkien-day-2026', 'Tolkien Day 2026', 'Tolkien Day honors the life and works of J. R. R. Tolkien, inviting readers to explore the rich landscapes, languages, and epic tales of Middle-earth through literature and shared appreciation.'),
  ('world-goth-day-2026-2', 'World Goth Day 2026', 'World Goth Day 2026 is an international celebration of goth subculture, encompassing its distinctive music, fashion, art, and community expression observed each year on 22 May.'),
  ('world-rock-day-2026', 'World Rock Day 2026', 'The World Rock Day honors the enduring legacy of rock music, its pioneering artists, and the cultural impact of the genre celebrated around the anniversary of the historic Live Aid concerts.')
ON CONFLICT (id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description;
