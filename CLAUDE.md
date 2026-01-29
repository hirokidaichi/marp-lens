# CLAUDE.md

このファイルはClaude Codeがこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**marpkit** は、Marpプレゼンテーション用のベクトル検索CLIツールです。Gemini APIを使用してスライドの意味検索を実現します。

## 技術スタック

- **言語**: TypeScript (ES2022, ESM)
- **ランタイム**: Node.js 18+
- **埋め込みモデル**: Gemini text-embedding-004 (768次元)
- **画像説明**: Gemini 2.0 Flash
- **データベース**: SQLite + sqlite-vec (ベクトル検索)
- **CLI**: Commander.js
- **テスト**: Vitest

## ディレクトリ構造

```
src/
├── cli.ts              # CLIエントリーポイント
├── index.ts            # ライブラリエクスポート
├── commands/           # CLIコマンド実装
│   ├── index-cmd.ts    # indexコマンド
│   ├── search-cmd.ts   # searchコマンド
│   ├── stats-cmd.ts    # statsコマンド
│   └── get-cmd.ts      # getコマンド
├── core/               # コアロジック
│   ├── database.ts     # SQLite + sqlite-vec操作
│   ├── gemini.ts       # Gemini API クライアント
│   └── parser.ts       # Marp Markdownパーサー
├── types/              # TypeScript型定義
│   └── index.ts
└── utils/              # ユーティリティ
    └── file-hash.ts    # ファイルハッシュ計算

tests/                  # テストファイル
samples/                # サンプルMarpスライド
```

## 開発コマンド

```bash
# 開発モードで実行
npm run dev -- <command> [options]

# 型チェック
npm run typecheck

# テスト実行
npm test

# テスト（ウォッチモードなし）
npm test -- --run

# ビルド
npm run build
```

## 主要な型定義

- `ParsedSlide`: パース済みスライド（heading, content, textOnly, speakerNotes, images）
- `ParsedDocument`: パース済みドキュメント（slides, frontmatter, title）
- `SlideRecord`: DB保存用スライドレコード
- `SearchResult`: 検索結果（similarity含む）
- `IndexOptions` / `SearchOptions`: コマンドオプション

## データベーススキーマ

- `files`: ファイル情報（path, hash, title, indexed_at）
- `slides`: スライド情報（file_id, slide_index, heading, content, text_only, speaker_notes, image_descriptions）
- `slide_embeddings`: ベクトルテーブル（sqlite-vec、768次元）

## 注意事項

- SQLカラム名はsnake_case、TypeScriptプロパティはcamelCase
- Gemini embedding は768次元固定
- 環境変数 `GEMINI_API_KEY` が必須
- インクリメンタルインデックスはファイルハッシュで判定

## テスト

テストは `tests/` ディレクトリにあり、以下をカバー:

- `parser.test.ts`: Markdownパーサー（frontmatter, スライド分割, speaker notes, 画像抽出）
- `database.test.ts`: DB操作（CRUD, ベクトル検索, 統計）
- `file-hash.test.ts`: ファイルハッシュ計算

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) で以下を実行:

- Node.js 18, 20, 22 でのテスト
- 型チェック
- ビルド確認
