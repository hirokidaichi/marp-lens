# marpkit

<p align="center">
  <img src="img/logo.png" alt="marpkit logo" width="200">
</p>

[![CI](https://github.com/hirokidaichi/marpkit/actions/workflows/ci.yml/badge.svg)](https://github.com/hirokidaichi/marpkit/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/marpkit.svg)](https://www.npmjs.com/package/marpkit)

Marpプレゼンテーション用のベクトル検索CLIツール。Gemini APIを使用してスライドの意味検索を実現します。

## 特徴

- **意味検索**: Geminiの埋め込みモデルを使用したセマンティック検索
- **インクリメンタルインデックス**: 変更されたファイルのみを再インデックス
- **画像説明**: Gemini Visionによるスライド内画像の自動説明（オプション）
- **スピーカーノート対応**: スピーカーノートも検索対象に含める
- **高速**: SQLite + sqlite-vecによる高速ベクトル検索
- **ウォッチモード**: ファイル変更時の自動再インデックス

## インストール

### npxで直接実行（推奨）

インストール不要で直接実行できます：

```bash
npx marpkit search "機械学習"
npx marpkit index -d ./slides
npx marpkit stats
```

### グローバルインストール

```bash
npm install -g marpkit
```

### ソースからビルド

```bash
git clone https://github.com/hirokidaichi/marpkit.git
cd marpkit
npm install
npm run build
```

## セットアップ

1. `.env`ファイルを作成:

```bash
cp .env.example .env
```

2. Gemini APIキーを設定:

```bash
# .env
GEMINI_API_KEY=your-api-key-here
```

APIキーは[Google AI Studio](https://aistudio.google.com/)で取得できます。

## 使い方

### スライドのインデックス

```bash
# カレントディレクトリのMarkdownファイルをインデックス
marpkit index

# 特定のディレクトリをインデックス
marpkit index -d ./slides

# 画像説明付きでインデックス
marpkit index -d ./slides --with-images

# インデックスを再構築
marpkit index -d ./slides --rebuild

# 特定のファイルのみインデックス
marpkit index -f ./slides/presentation.md
```

### スライドの検索

```bash
# 意味検索
marpkit search "機械学習の基礎"

# 結果数を制限
marpkit search "アーキテクチャ" --limit 5

# 類似度閾値を設定
marpkit search "API設計" --threshold 0.7

# JSON形式で出力
marpkit search "テスト" --format json
```

### 特定スライドの取得

```bash
# ファイル名とスライド番号で取得
marpkit get "presentation.md #3"

# パスの一部でも検索可能
marpkit get "slides.md #10"
```

### 統計情報の表示

```bash
marpkit stats
```

出力例:
```
Database Statistics

┌─────────────────────────┬────────────────────┐
│ Total Files             │ 3                  │
├─────────────────────────┼────────────────────┤
│ Total Slides            │ 17                 │
├─────────────────────────┼────────────────────┤
│ Total Embeddings        │ 17                 │
├─────────────────────────┼────────────────────┤
│ Database Size           │ 3.08 MB            │
└─────────────────────────┴────────────────────┘
```

### ウォッチモード（自動再インデックス）

```bash
# ファイル変更を監視して自動的に再インデックス
marpkit watch -d ./slides

# 画像説明付きで監視
marpkit watch -d ./slides --with-images
```

出力例:
```
marpkit watch
──────────────────────────────────────────────────
  Directory: /path/to/slides
  Database:  /path/to/marpkit.db
  Images:    No
──────────────────────────────────────────────────

Watching for changes... (Ctrl+C to stop)

15:30:45 [change] presentation.md
  Generating embeddings for 5 slides...
  Indexed: 5 slides
```

## コマンドリファレンス

### `marpkit index`

Markdownファイルをインデックスします。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-d, --dir <path>` | 検索対象ディレクトリ | カレントディレクトリ |
| `--db <path>` | データベースファイルパス | `./marpkit.db` |
| `-f, --file <path>` | 特定ファイルのみインデックス | - |
| `-r, --rebuild` | インデックスを再構築 | `false` |
| `-i, --with-images` | 画像説明を含める | `false` |

### `marpkit search <query>`

スライドを意味検索します。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-l, --limit <number>` | 最大結果数 | `10` |
| `-t, --threshold <number>` | 最小類似度閾値 (0-1) | `0` |
| `-o, --format <format>` | 出力形式 (`table` or `json`) | `table` |
| `--db <path>` | データベースファイルパス | `./marpkit.db` |

### `marpkit get <file-slide>`

特定のスライドの内容を取得します。

形式: `<ファイルパス> #<スライド番号>`

### `marpkit stats`

データベースの統計情報を表示します。

### `marpkit watch`

ファイル変更を監視して自動的に再インデックスします。

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-d, --dir <path>` | 監視対象ディレクトリ | カレントディレクトリ |
| `--db <path>` | データベースファイルパス | `./marpkit.db` |
| `-i, --with-images` | 画像説明を含める | `false` |

## 環境変数

| 変数 | 説明 | 必須 |
|------|------|------|
| `GEMINI_API_KEY` | Gemini APIキー | Yes |
| `MARPKIT_DB` | デフォルトのデータベースパス | No |
| `MARPKIT_DIR` | デフォルトのスライドディレクトリ | No |

## 開発

```bash
# 開発モードで実行
npm run dev -- index -d samples

# 型チェック
npm run typecheck

# テスト実行
npm test

# ビルド
npm run build
```

## AIエージェント向けスキル

AIエージェントにmarpkitスキルを追加すると、プレゼンテーションの検索・参照が可能になります。

```bash
npx skills add hirokidaichi/marpkit
```

追加後、エージェントに「スライドを検索して」「プレゼンの内容を教えて」などと指示すると、自動的にmarpkitを使用してスライドを検索します。

## 技術スタック

- **TypeScript**: 型安全な開発
- **Gemini API**: 埋め込み生成 (text-embedding-004) と画像説明 (gemini-2.0-flash)
- **SQLite + sqlite-vec**: ベクトルデータベース
- **Commander.js**: CLIフレームワーク
- **Vitest**: テストフレームワーク

## ライセンス

MIT
