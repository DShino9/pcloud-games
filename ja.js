'use strict';
/* 日本語で読めるようにする表（#86）。

   **中身の名前は書き換えない。** 倉庫のフォルダ名・ファイル名・fileid の表・
   棚に作ったフォルダ・端末が覚えた選択は、全部いまの綴りで噛み合っている。
   名前そのものを直すと、その全部がずれる（2026-08-31 に台帳を上書きして
   9,980冊を飛ばした件と同じ種類の事故になる）。
   **だから訳すのは「見せるとき」だけ。**

   なぜ要るか（2026-09-14 実測）:
     PC-98 3,583本のうち **3,229本（90%）が英数字だけの題名**
       DAIKOKAIJIDAI Ⅱ / AOKI / Sangokushi 4 - Power Up Kit …
     メーカーの階も 437 社すべて英字
       Koei / Falcom / Alice Soft / System Soft …
     機種の名も台帳のまま Famicom / Super Famicom / Nintendo DS
     ジャンルも Action / Role-Playing / Miscellaneous

   **確かなものだけ入れる。** 当てずっぽうで訳すと、別の本の名前が付く。
   分からないものは英字のまま出す（makers.js と同じ構え）。 */
(function (root) {

/* ---- 機種 ---- */
/* 台帳（games.json）と拡張子の表（EXT_SYS）が持っている綴りが鍵。
   **鍵は変えない**（棚のフォルダ名にも使われている）。 */
const SYS = {
  'Famicom': 'ファミコン',
  'Super Famicom': 'スーパーファミコン',
  'Nintendo 64': 'ニンテンドウ64',
  'Nintendo DS': 'ニンテンドーDS',
  'Sony PSP': 'PSP',
  'PC-98': 'PC-98',
  'MSX': 'MSX',
};

/* ---- ジャンル ---- */
/* OpenEmu 由来の台帳が英語で持っている。 */
const GENRE = {
  'Action': 'アクション',
  'Action Adventure': 'アクションアドベンチャー',
  'Adventure': 'アドベンチャー',
  'Driving': 'レース',
  'Role-Playing': 'ロールプレイング',
  'Simulation': 'シミュレーション',
  'Sports': 'スポーツ',
  'Strategy': 'シミュレーション・戦略',
  'Puzzle': 'パズル',
  'Shooter': 'シューティング',
  'Fighting': '格闘',
  'Miscellaneous': 'その他',
};

/* ---- メーカー ---- */
/* `PC98 Disk/<ここ>/` の階の綴り → 日本語。数の多い順に確かなものから。
   **綴り違いは同じ日本語に寄せる**（`ALICE` と `Alice Soft` は1つの棚に）。 */
const MAKER = {
  /* 器の名前（会社ではない）。会社に混ぜない。 */
  'UTILITIES_PROGRAMS': '道具・プログラム',
  'FREESOFT': 'フリーソフト',
  'OTHER-CDs': 'その他のCD',
  'OPERATING SYSTEM': '基本ソフト（OS）',
  'GAMES NEW': '新着ぶん',
  '0000_TOOL': '道具',
  'ETC': 'その他',
  'np2': 'エミュレータ本体',

  'Koei': '光栄',
  'Falcom': '日本ファルコム',
  'System Soft': 'システムソフト',
  'Star Craft': 'スタークラフト',
  'Fairytale': 'フェアリーテール',
  'Fairytale Red Zone': 'フェアリーテール（レッドゾーン）',
  'Fairytale Hard Cover': 'フェアリーテール（ハードカバー）',
  'Fairytale X Shitei': 'フェアリーテール（X指定）',
  'D.O': 'ディー・オー',
  'Compile': 'コンパイル',
  'Ascii': 'アスキー',
  'Elf': 'エルフ',
  'Alice Soft': 'アリスソフト',
  'ALICE': 'アリスソフト',
  'Cocktail Soft': 'カクテル・ソフト',
  'Cocktail Soft FMC': 'カクテル・ソフト',
  'Telenet Japan': '日本テレネット',
  'Artdink': 'アートディンク',
  'Family Soft': 'ファミリーソフト',
  'JAST': 'ジャスト',
  'Imagineer': 'イマジニア',
  'Pony Canyon': 'ポニーキャニオン',
  'Pony': 'ポニー',
  'Enix': 'エニックス',
  'Microcabin': 'マイクロキャビン',
  "Silky's": 'シルキーズ',
  'Kogado Software Products': '工画堂スタジオ',
  'Victor Musical Industries': 'ビクター音楽産業',
  'Victor Entertainment': 'ビクターエンタテインメント',
  'Birdy Soft': 'バーディーソフト',
  'Agumix': 'アグミックス',
  'KSS': 'ケイエスエス',
  'T&E': 'T&Eソフト',
  'Apple Pie': 'アップルパイ',
  'May-Be Soft': 'メイビーソフト',
  'May-Be Soft Truse': 'メイビーソフト',
  'Electronic Arts Victor': 'エレクトロニック・アーツ・ビクター',
  'Electronic Arts': 'エレクトロニック・アーツ',
  'Bothtec Inc': 'ボーステック',
  'Queen Soft': 'クインソフト',
  'Microprose Japan': 'マイクロプローズ・ジャパン',
  'Mediax - Pasocon Paradise Disk': 'メディアックス（パソコンパラダイス）',
  'Game Technopolis': 'ゲームテクノポリス',
  'Wolf Team': 'ウルフチーム',
  'Himeya Soft': '姫屋ソフト',
  'Fairy Dust': 'フェアリーダスト',
  'Four Nine': 'フォーナイン',
  'Janis': 'ジャニス',
  'System Sacom': 'システムサコム',
  'Riverhill Soft': 'リバーヒルソフト',
  'Nihon Create': '日本クリエイト',
  'Data West': 'データウエスト',
  'Zainsoft': 'ザインソフト',
  'Gainax': 'ガイナックス',
  'Illusion': 'イリュージョン',
  'Hobby Japan': 'ホビージャパン',
  'Broderbund Japan Inc': 'ブローダーバンドジャパン',
  'Ponytail Soft': 'ポニーテールソフト',
  'Wiz': 'ウィズ',
  'ZYX': 'ジックス',
  'Ving': 'ヴィング',
  'Ucom': 'ユーコム',
  'Glodia': 'グローディア',
  'Champion Soft': 'チャンピオンソフト',
  "C's Ware": 'シーズウェア',
  'BPS': 'ビー・ピー・エス',
  'Ange': 'アンジュ',
  'Inter Heart': 'インターハート',
  'PIL': 'ピル',
  'Thinking Rabbit': 'シンキングラビット',
  'Discovery Software': 'ディスカバリーソフト',
  'Orange House': 'オレンジハウス',
  'Panther Software': 'パンサーソフトウェア',
  'Humming Bird Soft': 'ハミングバードソフト',
  'Home Data': 'ホームデータ',
  'Giga': 'ギガ',
  'Aypio': 'アイピオ',
  'Game Arts': 'ゲームアーツ',
  'dB-Soft': 'デービーソフト',
  'General Support Software': 'ジェネラルサポート',
  'You en tai': '遊演体',
  'Tonkin House': 'トンキンハウス',
  'Sierra On Line Japan': 'シエラ・オンライン・ジャパン',
  'Right Stuff': 'ライトスタッフ',
  'Ringer Bell': 'リンガーベル',
  'Tiare': 'ティアレ',
  'Pack in Video': 'パック・イン・ビデオ',
  'Leaf': 'リーフ',
  'Japan Home Video': '日本ホームビデオ',
  'Hudson': 'ハドソン',
  'Banpresto': 'バンプレスト',
  'Acclaim Japan': 'アクレイムジャパン',
  'Misty': 'ミスティ',
  'Libido': 'リビドー',
  'Forest': 'フォレスト',
  'Hot B': 'ホット・ビィ',
  'Dynamic Production': 'ダイナミック企画',
  'Popcom Soft': 'ポプコムソフト',
  'Black Package': 'ブラックパッケージ',
  'Desire': 'デザイア',
  'Konami': 'コナミ',
  'Capcom': 'カプコン',
  'Taito': 'タイトー',
  'Sun Soft': 'サンソフト',
  'Irem Japan': 'アイレム',
  'Natsume': 'ナツメ',
  'Square': 'スクウェア',
  'Microsoft': 'マイクロソフト',
  'Micronet': 'マイクロネット',
  'Nihon Bussan': '日本物産',
  'NCS': '日本コンピュータシステム',
  'Arsys': 'アルシスソフトウェア',
  'NEC Avenue': 'NECアベニュー',
  'NEC Interchannel': 'NECインターチャネル',
  'Media Factory': 'メディアファクトリー',
  'Gust': 'ガスト',
  'Nexton': 'ネクストン',
  'Teichiku': 'テイチク',
  'Tokuma Shoten Publishing': '徳間書店',
  'Shogakukan Production': '小学館プロダクション',
  'Mainichi Communications': '毎日コミュニケーションズ',
  'Carry Lab': 'キャリーラボ',
  'Random House': 'ランダムハウス',
  'Takeru': 'タケル',
  'Takeru Project': 'タケル',
  'Tecnosoft': 'テクノソフト',
  'Pandora Box': 'パンドラボックス',
  'Nihon Igo Soft': '日本囲碁ソフト',
  'Softpal': 'ソフトパル',
  'Brain Grey': 'ブレイングレー',
  'Abogado Powers': 'アボガドパワーズ',
  'Sur de Wave': 'シュールドワーブ',
  'Sogna': 'ソグナ',
  'Mink': 'ミンク',
  'Great': 'グレイト',
  'Scoop': 'スクープ',
  'Hulinks': 'ヒューリンクス',
  'Magical Company': 'マジカル',
  'Nexus Interact': 'ネクサスインタラクト',
  'Movic': 'ムービック',
  'Micro Mouse': 'マイクロマウス',
  'Studio Twinkle': 'スタジオトゥインクル',
  'Studio Milk': 'スタジオミルク',
  'Foster': 'フォスター',
  'Striker': 'ストライカー',
  'Allex': 'アレックス',
  'Pegasus Japan': 'ペガサスジャパン',
};

/* ---- 題名 ---- */
/* 鍵は**小文字に均した題名**。値が日本語の正しい題名。
   後ろに付く「パワーアップキット」などは SUFFIX 側で外してから引くので、
   ここには**素の題名だけ**を書く。 */
const TITLE = {
  /* 光栄 */
  'air management': 'エアーマネジメント',
  'air management 2': 'エアーマネジメントII 航空王をめざせ',
  'aoki ookami to shiroki mejika - genghis khan': '蒼き狼と白き牝鹿 ジンギスカン',
  'aoki ookami to shiroki mejika - banchou hishi': '蒼き狼と白き牝鹿 元朝秘史',
  'band kun': 'バンドくん',
  'daikoukaijidai': '大航海時代',
  'daikoukaijidai 2': '大航海時代II',
  'daikokaijidai': '大航海時代',
  'daikokaijidai 2': '大航海時代II',
  'danchi tsuma no yuuwaku': '団地妻の誘惑',
  'delphoi no shintaku': 'デルフォイの神託',
  'dokuritsusensoo - liberty or death': '独立戦争 リバティ オア デス',
  'europa sensen': 'ヨーロッパ戦線',
  'genpei gassen': '源平合戦',
  'inindo': '伊忍道 打倒信長',
  'ishin no arashi': '維新の嵐',
  'kamigami no daiti ~kojiki gaiden~': '神々の大地 古事記外伝',
  'kouryuki': '項劉記',
  "l'empereur": 'ランペルール',
  'leading company': 'リーディングカンパニー',
  'mahjong taikai': '麻雀大会',
  'nobunaga no yabou': '信長の野望',
  'nobunaga no yabou zenkoku-ban': '信長の野望 全国版',
  'nobunaga no yabou sengoku gunyuuden': '信長の野望 戦国群雄伝',
  'nobunaga no yabou busho fuunroku': '信長の野望 武将風雲録',
  'nobunaga no yabou haoden': '信長の野望 覇王伝',
  'nobunaga no yabou tenshouki': '信長の野望 天翔記',
  'royal blood': 'ロイヤルブラッド',
  'sangokushi': '三國志',
  'sangokushi 2': '三國志II',
  'sangokushi 3': '三國志III',
  'sangokushi 4': '三國志IV',
  'sangokushi 5': '三國志V',
  'sangokushi eiketsuden': '三國志英傑伝',
  'gunyuu sangokushi': '群雄三国志',
  'suikoden - tenmei no chikai': '水滸伝 天命の誓い',
  'taikoo risshiden': '太閤立志伝',
  'taikoo risshiden 2': '太閤立志伝II',
  'tamashii no mon': '魂の門',
  'teitoku no ketsudan': '提督の決断',
  'teitoku no ketsudan 2': '提督の決断II',
  'teitoku no ketsudan 3': '提督の決断III',
  'top management': 'トップマネジメント',
  'top management 2': 'トップマネジメントII',
  'winning post': 'ウイニングポスト',
  'winning post 2 plus': 'ウイニングポスト2 プラス',

  /* 日本ファルコム */
  'advanced lord monarch': 'アドバンスド ロードモナーク',
  'asteka': 'アステカ',
  'asteka 2': 'アステカII 太陽の神殿',
  'brandish': 'ブランディッシュ',
  'brandish 2': 'ブランディッシュ2',
  'brandish 3': 'ブランディッシュ3',
  'brandish vt': 'ブランディッシュVT',
  'dinosaur': 'ダイナソア',
  'eiyuu densetsu - legend of heroes': '英雄伝説',
  'eiyuu densetsu': '英雄伝説',
  'eiyuu densetsu 2': '英雄伝説II',
  'eiyuu densetsu 3': '英雄伝説III 白き魔女',
  'eiyuu densetsu 3 - shiroki majoo': '英雄伝説III 白き魔女',
  'eiyuu densetsu 4 - akai shizuku': '英雄伝説IV 朱紅い雫',
  'lord monarch': 'ロードモナーク',
  'popful mail': 'ポップフルメイル',
  'pyramid sorcerian': 'ピラミッド ソーサリアン',
  'revival xanadu': 'リバイバル ザナドゥ',
  'revival xanadu 2 remix': 'リバイバル ザナドゥ2 リミックス',
  'romancia -dragon slayer jr-': 'ロマンシア',
  'sengoku sorcerian': '戦国ソーサリアン',
  'sorcerian': 'ソーサリアン',
  'star trader': 'スタートレーダー',
  'xanadu': 'ザナドゥ',
  'ys 1': 'イースI',
  'ys 2 - ancient ys vanished the final chapter': 'イースII',
  'ys 2': 'イースII',
  'ys 3 - wanderers from ys': 'イースIII ワンダラーズフロムイース',
  'ys 3': 'イースIII ワンダラーズフロムイース',
  'xak': 'サーク',
  'xak2': 'サークII',

  /* アリスソフト */
  'rance': 'ランス',
  'rance 2': 'ランスII',
  'rance 3': 'ランスIII',
  'rance 4': 'ランスIV',
  'alice no yakata': 'アリスの館',
  'alice no yakata 2': 'アリスの館2',
  'alice no yakata 3': 'アリスの館3',
  'dalk': 'DALK（ダルク）',
  'toushintoshi 1': '闘神都市',
  'toushintoshi 2': '闘神都市II',
  'ayumi chan monogatari': 'あゆみちゃん物語',
  'abunai bunkasai': 'あぶない文化祭',
  'abunai tengu densetsu': 'あぶない天狗伝説',
  'doctor stop': 'Dr.STOP!',
  'little vampire': 'リトルバンパイア',
  'otome senki': '乙女戦記',
  'pro student g': 'プロ学生G',
  'fukei san vx': '婦警さんVX',
  'mugen hoyo': '夢幻泡影',
  'ambivalenz': 'アンビバレンツ',
  'crescent moon girl': 'クレセントムーンがーる',
  'uchu kaitou funny bee': '宇宙快盗ファニーBee',
  'only you seikimatsuno juliette tachi': 'Only You 世紀末のジュリエット達',

  /* システムソフト */
  'daisenryaku': '大戦略',
  'daisenryaku 2': '大戦略II',
  'daisenryaku 3': '大戦略III',
  'daisenryaku 4': '大戦略IV',
  "daisenryaku 3'90": "大戦略III'90",
  'super daisenryaku 98': 'スーパー大戦略98',
  'campaign daisenryaku 2': 'キャンペーン版大戦略II',
  'gendai daisenryaku ex': '現代大戦略EX',
  'kuugun daisenryaku': '空軍大戦略',
  'tenka touitsu 1': '天下統一',
  'tenka touitsu 2': '天下統一II',
  'master of monsters': 'マスターオブモンスターズ',
  'master of monsters 2': 'マスターオブモンスターズ2',
  'master of monsters final': 'マスターオブモンスターズ ファイナル',
  'nectaris': 'ネクタリス',
  'shanghai': '上海',
  'shanghai 2': '上海II',
  'lode runner hozonban': 'ロードランナー 保存版',
  'robo crush 98': 'ロボクラッシュ98',
  'robo crush 98 2': 'ロボクラッシュ98・2',
  'robo crush 2': 'ロボクラッシュ2',
  'tir-nan-og 1': 'ティル・ナ・ノーグ',
  'tir-nan-og 2': 'ティル・ナ・ノーグII',
  'youtoden': '妖刀伝',
  'air combat': 'エアーコンバット',
  'crystania': 'クリスタニア',
  'lord of wars': 'ロードオブウォーズ',
  'load of wars': 'ロードオブウォーズ',
  'lord of panzers': 'ロードオブパンツァーズ',
  'imperial force': 'インペリアルフォース',
  'quizz tonosama no yabou': 'クイズ殿様の野望',
  'quiz chiryaku no hasha - sangokushi kitan': 'クイズ地略の覇者 三国志奇譚',
  'godzilla': 'ゴジラ',
  'solid lancer': 'ソリッドランサー',
  'panzer keil - blitzkrieg 2 -': 'パンツァーカイル',

  /* ほか（pc98-alias.txt から引き継いだ確かなもの） */
  'aya3': 'はっちゃけあやよさん3',
  'aya3m': 'はっちゃけあやよさん3',
  'husler 2055': 'ハスラー2055',
  'lipstick adv2': 'リップスティックアドベンチャー2',
  'lipstick adv3': 'リップスティックアドベンチャー3',
  'aoki': '蒼き狼と白き牝鹿',
  'haten': '覇天',
  'emerald dragon': 'エメラルドドラゴン',
  'castles': 'キャッスルズ',
  'lemmings': 'レミングス',
  'mahjong gokuu professional': '麻雀悟空 プロフェッショナル',
  'pc-9801 game pack vol.1': 'ゲームパック',
};

/* 後ろに付く「別冊」の言い方。**素の題名を引く前に外し、訳した後で戻す。**
   `Sangokushi 4 - Power Up Kit` の1件ずつを表に書かずに済む。 */
const SUFFIX = [
  [/\s*[-–]?\s*power\s*-?\s*up\s*kit$/i,       ' パワーアップキット'],
  [/\s*[-–]?\s*powerup-?kit$/i,                ' パワーアップキット'],
  [/\s*[-–]?\s*hint\s*disk$/i,                 ' ヒントディスク'],
  [/\s*[-–]?\s*option\s*disk$/i,               ' オプションディスク'],
  [/\s*[-–]?\s*graphic\s*disk(\s*v[\d.]+)?$/i, ' グラフィックディスク'],
  [/\s*[-–]?\s*utility\s*disk$/i,              ' ユーティリティディスク'],
  [/\s*[-–]?\s*map\s*collection$/i,            ' マップ集'],
  [/\s*[-–]?\s*data\s*collection$/i,           ' データ集'],
  [/\s*[-–]?\s*unit\s*pack$/i,                 ' ユニットパック'],
  [/\s*[-–]?\s*renewal$/i,                     ' リニューアル'],
  [/\s*[-–]?\s*(tuika\s*)?scenario\s*(\d)$/i,  ' 追加シナリオ$2'],
  [/\s*[-–]?\s*scenario\s*shuu\s*(\d)$/i,      ' シナリオ集$1'],
  [/\s*[-–]?\s*scenario\s*editor$/i,           ' シナリオエディタ'],
  [/\s*[-–]?\s*kakuchoo$/i,                    ' 拡張データ'],
  /* PC-98 の実物は「システム／ユーザー／データ」と役割で分かれている。
     `SANGOKUSHI Ⅳ_SYSTEM` の一枚ずつを表に書かずに済ませる。 */
  [/[ _-](system|sys)$/i,                      '（システム）'],
  [/[ _-](user|usr)$/i,                        '（ユーザー）'],
  [/[ _-](dat|data)$/i,                        '（データ）'],
  [/[ _-]game$/i,                              '（ゲーム）'],
  [/[ _-]save$/i,                              '（セーブ）'],
  [/[ _-]opening$/i,                           '（オープニング）'],
  [/[ _-]ending$/i,                            '（エンディング）'],
  [/[ _-]umi$/i,                               '（海）'],
];

/* ---- 掃除 ---- */
/* 題名に混ざる「本体でない書き足し」。**中身を見分ける数字は落とさない**
   （`Rance 4.1` と `Rance 4.2` は別の本）。 */
/* **順が要る。** `(1991)(Falcom)` を先に落とさないと、`(1991)` だけ消えて
   `(Falcom)` が題名に残る（実測で残った）。長い形から順に。 */
const NOISE = [
  /\((19|20)\d\d\)\s*\([^)]*\)/g,                   /* (1991)(Falcom) */
  /\((19|20)\d\d\)/g,                               /* (1991) */
  /\((FIX|VFL|DBS|FIM|FIM-D88|FDI|FDD|HDM|HDI|XDF|D88|2HD|NFD|TFD|DCP|DCU|DIP|FDI-XDF|FDI-HDI)\)/gi,
  /\((FMG[^)]*|Pirate|Hack[^)]*|Rev\s*\w+|PRG\d|MODE7|WRG\w*)\)/gi,
  /\((JU|J|U|E|UE|JE|W|Japan|USA|Europe|World)\)/gi,
  /\[(T-Eng[^\]]*|T-Jpn[^\]]*|Demo|demo)\]?/g,
  /\[[!aboptfh]\d*\]/gi,
  /\[[a-z]\]/gi,
  /\[h[-M]?[\w.]*\]/gi,                                /* [h-FFE] [hM01] */
  /* どの本にも付いている機種・形式の断り。全部に付くので見分けの役に立たない。
     **頭に立つものだけ**落とす（題名の途中の括弧は意味があることが多い）。 */
  /^[【({\[]\s*(PC-?98(01)?|エミュ|FD|HD|HDI|FDI|D88)\s*[)}\]】]\s*/i,
  /^[【({\[]\s*(PC-?98(01)?|エミュ|FD|HD|HDI|FDI|D88)\s*[)}\]】]\s*/i,
  /\s*[([]\s*(fdi|fdd|hdm|hdi|d88|xdf|nfd|2hd|files?)\s*[)\]]\s*$/i,
];

/* 半角カナだけを直す。`ﾄﾞﾗｺﾞﾝ` → `ドラゴン`。
   **NFKC を丸ごと掛けない。** それだと `ぎゅわんぶらあ自己中心派２` が `…派2` に、
   `上海Ⅱ` が `上海II` になる —— **正しい題名を崩してしまう。**
   半角カナの並びだけを取り出して直せば、直すべきものだけが直る。 */
const HANKANA = /[\uFF61-\uFF9F]+/g;
const norm = s => {
  try { return String(s).replace(HANKANA, m => m.normalize('NFKC')); }
  catch (e) { return String(s); }
};

/* 表を引くための鍵。**こちらは思い切り均す**（見せる名は崩さない）。
   `SANGOKUSHI Ⅳ` も `Sangokushi 4` も同じ鍵 `sangokushi 4` になる。 */
const ROMAN = [['viii', 8], ['vii', 7], ['iii', 3], ['xii', 12], ['xi', 11],
               ['ix', 9], ['iv', 4], ['vi', 6], ['ii', 2], ['x', 10], ['v', 5], ['i', 1]];
function keyOf(t) {
  let k;
  try { k = String(t).normalize('NFKC'); } catch (e) { k = String(t); }
  k = k.toLowerCase().replace(/\s+/g, ' ').trim();
  /* 語の切れ目に立つローマ数字だけを算用数字に。`i` が名前の一部のときは触らない。 */
  for (const [r, n] of ROMAN) {
    k = k.replace(new RegExp('(^|[\\s_-])' + r + '(?=$|[\\s_-])', 'g'), (_, p) => p + n);
  }
  return k.replace(/\s+/g, ' ').trim();
}

function tidy(name) {
  let t = norm(name);
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t.replace(/[（(]\s*[)）]/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

/* ---- 引く ---- */
function sysJa(s)   { return SYS[s] || s || ''; }
function genreJa(g) { return GENRE[g] || g || ''; }
function makerJa(m) { return MAKER[m] || norm(m || ''); }
function sortKey(name) { return keyOf(tidy(name)); }

/* 題名。**当たらなければ掃除しただけのものを返す**（無理に訳さない）。 */
function titleJa(name) {
  const t = tidy(name);
  if (!t) return '';
  const hit = TITLE[keyOf(t)];
  if (hit) return hit;
  /* 後ろの「別冊」「役割」を外して、素の題名で引き直す。**二段まで**
     （`Sangokushi 4 - Power Up Kit_SYSTEM` のような重ね書きがある）。 */
  for (let pass = 0, cur = t, tails = ''; pass < 2; pass++) {
    let cut = false;
    for (const [re, tail] of SUFFIX) {
      const m = cur.match(re);
      if (!m) continue;
      cur = cur.replace(re, '').trim();
      tails = tail.replace(/\$(\d)/g, (_, i) => m[Number(i)] || '') + tails;
      cut = true;
      break;
    }
    if (!cut) break;
    const b = TITLE[keyOf(cur)];
    if (b) return b + tails;
  }
  return t;
}

/* **道具・エミュ本体・ブランクは本ではない。** 一覧に混ざると探せない
   （PC-98 に `np2tool` `np21_082` `BLANKHD` `起動` が並んでいた）。 */
const NOT_A_GAME = [
  /^np2[\w.-]*$/i, /^np21[\w.-]*$/i, /^np2x64$/i, /^anex86/i, /^t98/i,
  /^blank(hd|fd)?$/i, /^format$/i, /^(起動|起動ディスク|システム|system)$/i,
  /^disk\s*\d+$/i, /^dspl\d+$/i, /^mkanbmp\d+$/i, /^vf\d{6}$/i,
];
/* **区画そのものが道具の置き場**というものがある。1本ずつ名前で見分けるより、
   そこに入っていることを見るほうが確か（`UTILITIES_PROGRAMS` に 255本、
   `OPERATING SYSTEM` に 33本。MIFES・Turbo C++・MS-DOS が
   ゲームの一覧の頭に並んでいた）。 */
const TOOL_DIR = /\/(UTILITIES_PROGRAMS|OPERATING SYSTEM|0000_TOOL|整理隔離|削除待ち|競合残骸[^/]*|エミュ本体[^/]*)(\/|$)/i;
function isTool(name, path) {
  const t = tidy(name);
  if (!t) return true;                                   /* 名前が無いものは出さない */
  if (NOT_A_GAME.some(re => re.test(t))) return true;
  return TOOL_DIR.test(String(path || '') + '/');
}

root.JA = { sysJa, genreJa, makerJa, titleJa, tidy, isTool, sortKey, keyOf,
            SYS, GENRE, MAKER, TITLE };

})(window);
