-- Languages shipped in the first release. To add one later, insert a row in a NEW migration
-- (never edit this file) and add its catalog to @foodboll/i18n. See docs/i18n.md.
INSERT INTO "languages" ("code", "native_name", "english_name", "enabled", "sort_order") VALUES
	('ko', '한국어', 'Korean', true, 1),
	('uz', 'O‘zbekcha', 'Uzbek', true, 2)
ON CONFLICT ("code") DO NOTHING;
