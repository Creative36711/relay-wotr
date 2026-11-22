# UI и визуальные assets: Godot, SVG, генерация и хромакей

Это обязательный визуальный контракт для карточек, которые меняют интерфейс,
стратегическую карту, HUD, editor или custom art WOTR Remaster. Решение записано
как `WOTR-D-015` в `docs/DECISIONS.md`.

Цель — не «всё SVG» и не набор несвязанных AI-картинок. Красивый интерфейс
получается из одной системы: **Godot задаёт структуру и состояния, вектор —
точную геометрию, растр — материал и атмосферу**.

## 1. Кто за что отвечает

- **Godot World Engineer**: `Control`/`Container`, anchors, Theme, состояния,
  ввод, responsive layout, подключение готовых assets и automated screenshots.
- **Technical Artist**: style brief, palette/material language, генерация и
  отбор изображений, SVG-источники, chromakey/alpha cleanup, 9-slice margins,
  provenance, import/budget report.
- **Localization & Cultural QA Engineer**: шрифты, shaping, переполнение и
  читаемость для `en`, `ru`, `zh-Hans`, `ja`, `pt-BR`, `de`, `fr`, `ko`.
- **UX & Modding Auditor**: независимо открывает реальные Godot renders и
  проверяет цельность, scale, focus, контраст, края, локали и pack boundary.

Простой `StyleBoxFlat` или маленькую функциональную SVG-иконку может сделать
Godot World Engineer в своей карточке. **Любая генерация изображений,
иллюстративный asset set или сложный material skin требует отдельного Scope
Technical Artist**; интеграция остаётся у Godot World Engineer.

## 2. Сначала структура, потом skin

Runtime UI строится из Godot `Control` nodes, containers и `Theme` resources.
Изображение никогда не является логикой экрана.

Обязательные свойства:

1. layout переживает изменение окна и UI scale без ручных координат для каждого
   разрешения;
2. текст остаётся настоящим текстом движка и приходит из catalog ID;
3. у интерактивного элемента есть normal, hover, pressed, disabled и keyboard
   focus states;
4. hit area, tooltip и accessibility semantics не зависят от прозрачных
   пикселей картинки;
5. decorative art можно заменить или отключить без изменения команд и state;
6. generated mockup полного экрана — только style reference, не готовая сцена.

## 3. Матрица выбора

| Задача | Правильный механизм |
|---|---|
| Layout, input, focus, текст, states | Godot `Control`/`Container` + `Theme` |
| Однотонная рамка, радиус, border, focus ring | `StyleBoxFlat` или простой shader |
| Пиктограмма, glyph, маска, маркер, курсор | SVG с чистыми paths и `current` palette contract |
| Материальная рамка/кнопка, которая тянется | PNG с alpha + `StyleBoxTexture`/`NinePatchRect` |
| Камень, металл, дерево, ткань, пергамент, резьба | сгенерированный/авторский raster asset |
| Портрет, loading art, province illustration | raster illustration; отдельная карточка/provenance |
| Повторяемый glow/noise/selection effect | shader, а не пачка почти одинаковых PNG |
| 3D prop/mesh/rig/animation | Blender/bpy → GLB → Godot render |
| Надпись, число, локализованная подпись | Godot font/catalog; никогда не генератор изображения |

Правило «масштабируется — значит SVG» недостаточно. Материальный raster frame
масштабируется корректно через 9-slice: углы сохраняются, растягиваются только
разрешённые полосы. И наоборот, full-screen SVG с сотнями градиентов обычно
хуже компактного raster + Theme.

## 4. Style brief до первой генерации

До расхода image quota карточка фиксирует:

- назначение экрана и список **конкретных** assets;
- style anchor: эпоха/настроение без ссылки на стиль живого художника;
- palette с hex-цветами и правила faction/accent/focus/disabled;
- material vocabulary, форму углов/рамок, толщину линий и направление света;
- target size, safe padding, 9-slice/content margins и Godot node-потребитель;
- состояния элемента и какие из них выводятся tint/shader, а не новой картинкой;
- license/provenance boundary и запрет копирования retail/официального artwork;
- generation budget и путь результата.

Сначала выбирается один style anchor, затем из него выводится набор. Десять
красивых, но разных по языку картинок — не UI system.

## 5. Как использовать генерацию Arena

Доступный бюджет (сейчас до **10 изображений за ход**) — верхняя граница, а не
цель. Карточка заранее называет назначение каждого изображения. Не расходовать
квоту «на всякий случай».

Практичный бюджет одного визуального хода:

1. один style anchor или один material sample;
2. две–четыре отдельные кандидатуры ключевого элемента;
3. выбранные production elements;
4. одна correction/integration iteration после просмотра в Godot.

Каждая генерация — **одно самостоятельное изображение**. Не просить collage,
contact sheet, grid или несколько элементов внутри одного файла: варианты и
разные assets создаются отдельными результатами. Зависимый asset не генерируют,
пока не выбран style anchor.

Хороший prompt явно задаёт:

- функцию: `nine-slice panel frame`, `button cap`, `province medallion`, а не
  просто «красивый fantasy UI»;
- ортографический/front view, симметрию или допустимую асимметрию;
- material, palette, lighting direction, line weight и свободный padding;
- `no text, no letters, no numbers, no logo, no watermark`;
- `original medieval-fantasy design, no official game or film artwork`;
- transparent background, если модель это поддерживает; иначе точный chromakey
  contract из следующего раздела.

Не имитировать именованного современного художника и не загружать чужой art как
необъявленный reference. Retail UI можно исследовать как поведенческий baseline,
но нельзя вырезать и публиковать его элементы как custom assets.

## 6. Alpha предпочтительнее; chromakey — воспроизводимый fallback

Если генератор уверенно отдаёт прозрачный PNG, использовать alpha. Хромакей
нужен, когда прозрачный фон недоступен или нестабилен.

Для chromakey prompt требует:

```text
isolated object on a perfectly flat solid #00FF00 background,
no gradient, no floor, no cast shadow on the background,
no green rim light, generous empty padding
```

Обработка закреплённым инструментом:

```bash
tools/arena/bootstrap.sh --art
/tmp/mediaenv/bin/cutout-chromakey input.png output.png --mode auto --crop
```

Инструмент использует строгий зелёный ключ и despill, защищая cyan/turquoise.
Это не восстанавливает корректную полупрозрачность. Волосы, дым, стекло, glow,
motion blur и мягкие тени лучше делать отдельным shader/layer или получать с
настоящим alpha. Чисто зелёные детали внутри объекта хромакей удалит.

После вырезания обязательно открыть результат:

1. на checkerboard, белом и почти чёрном фоне;
2. при 100% и 200% масштабе;
3. без зелёного ореола, дыр, обрубленной тени и accidental crop;
4. внутри реальной Godot сцены, а не только в image viewer.

## 7. Файлы и provenance

Рекомендуемый WOTR layout:

```text
art/wotr_remaster/ui/<set>/
  manifest.json
  prompts/
  source/                 # только выбранные разумного размера sources

godot/wotr_remaster/ui/
  themes/
  assets/<set>/           # оптимизированные runtime SVG/PNG/WebP
  scenes/
```

Не коммитить unselected generations, grids, временные masks и дубликаты.
Большой выбранный source можно хранить во внешнем artifact storage, но manifest
обязан содержать content hash и путь; runtime derivative должен быть
воспроизводимо связан с ним.

Минимум записи manifest для каждого asset:

- stable asset ID, назначение и consuming scene/node;
- author/tool (`Arena image generation`, `SVG`, `bpy` и т. п.) и дата;
- prompt/negative constraints или source procedure;
- reference inputs с лицензией; пустой список тоже фиксируется;
- source SHA-256 и selected status;
- crop/key/despill/resize command и output SHA-256;
- runtime dimensions, color space, alpha mode и import settings;
- 9-slice stretch/content margins, если применимо;
- license/allowed use и известные ограничения.

Prompt не является доказательством результата: в evidence прикладываются hash и
открытый render выбранного файла.

## 8. Что запрещено

- делать экран одной картинкой и накладывать invisible hit boxes;
- генерировать текст, цифры, localization или keyboard hints внутри PNG;
- собирать камень/металл из десятков SVG gradients только ради «вектора»;
- генерировать 16×16 functional icon, если её проще и чётче задать SVG;
- создавать отдельный raster для каждого hover/disabled state, когда достаточно
  Theme tint/shader;
- принимать source preview без Godot import/render;
- смешивать assets разных palette/light/material grammar в одном наборе;
- коммитить official/retail art, watermark или asset без provenance;
- считать image quota обязательством потратить все десять генераций.

## 9. Карточка и оракул

Coordinator не выдаёт абстрактное «сделать красиво». Visual card содержит:

- named asset list, target scenes/nodes и write zones;
- style brief и generation budget (0–10 для текущей Arena quota);
- source/runtime paths и provenance requirements;
- states, resolutions, UI scales и затронутые product locales;
- declared build/retail Cost gate;
- команды обработки/import и acceptance screenshots.

Минимальная приёмка:

1. source/manifest/runtime hashes записаны; права и references понятны;
2. Godot import не выдаёт ошибок, scene не содержит absolute paths;
3. normal/hover/pressed/disabled/focus читаются и не меняют layout;
4. тексты всех затронутых product locales остаются настоящим текстом и не
   обрезаются молча;
5. render проверен минимум на 1280×720 и 1920×1080 плюс заявленный UI scale;
6. alpha/chromakey края проверены на светлом и тёмном фоне;
7. агент открыл screenshot/video и описал видимое; независимый UX auditor
   повторил проверку;
8. frame time, texture memory/размеры и все `not run` сообщены как факты.

Для раннего walking skeleton допускается небольшой coherent first-pass set, но
не случайные placeholders. Production-quality claim требует отдельной art/UX
приёмки, а не только зелёного headless smoke.

## 10. Быстрый выбор

```text
Это layout, текст, input или state?        -> Godot Control/Theme
Это простая точная форма/иконка/маска?     -> SVG
Это плоский масштабируемый border?         -> StyleBoxFlat/SVG
Это материальная растяжимая рамка?         -> alpha raster + 9-slice
Это фактура/портрет/атмосферный artwork?   -> генерация/авторский raster
Нужна прозрачность?                        -> native alpha; chromakey fallback
Есть текст внутри изображения?             -> переделать: текст должен быть в Godot
Нет style brief/provenance/consumer?       -> не генерировать
