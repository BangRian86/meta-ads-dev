# PRD — 06-copywriting-lab

## Problem yang Diselesaikan

Media buyer butuh varian copy ad cepat, sering, dan dengan brand voice
yang konsisten. Generate manual lama; copy AI generic seringkali
melanggar forbidden word atau tone yang salah. Modul ini memberi:
brief sebagai single source-of-truth (audience, benefit, tone,
forbidden words), generator dengan strategi yang bisa dipilih
(heuristic gratis vs AI), dan reviewer multi-dimensi untuk approval
gate sebelum copy dipakai di iklan.

## Fitur Tersedia

- **Brief management** (CRUD) — title, product, audience, key benefits,
  tone, forbidden words, target action.
- **Generate variants** dengan dua strategi:
  - **Heuristic** — angle templates (benefit-led, urgency, social proof, dll),
    deterministic, no API cost.
  - **AI rescue** — Claude untuk regenerate copy untuk ad yang
    underperforming (`generateAiVariantsForBadAd`).
- **Review variant** — skor per dimension (clarity, emotion, urgency,
  brand fit, CTA alignment), notes tertulis, deteksi forbidden words.
- **Approval workflow** — `draft → approved | rejected` dengan audit.
- **Variant tree** — track parent → child untuk iterasi.
- **Review external copy** — copy yang sudah live di Meta bisa di-review
  juga (untuk audit kualitas iklan existing).
- **Token cost tracking** — usage Claude tercatat di `ai_usage_logs`
  dengan USD cost.

## Non-goals

- **Tidak meng-publish** copy ke Meta — itu `16-ad-publisher`.
- **Tidak melakukan A/B testing scheduling** — modul cuma men-generate;
  test setup di tools lain.
- **Tidak meng-handle gambar / video** — copy text only.
- **Tidak ada brand library** — brand voice ditangkap di field
  brief.tone + brief.notes; tidak ada repo brand asset yang
  shared.
- **Tidak menerjemahkan multi-language** otomatis — generator pakai
  bahasa brief apa adanya.

## Success Metrics

- **Generate latency p95** — heuristic < 100 ms; AI < 8 detik (Claude
  streaming structured output).
- **Forbidden word leak = 0** — variant approved tidak boleh ada
  forbidden word.
- **Reviewer signal** — ad yang ke-approve di reviewer punya CTR
  ≥ baseline akun-nya saat live (validasi qualitatif).
- **AI cost predictability** — tiap variant AI tercatat cost USD,
  total bulanan visible di `ai_usage_logs`.
- **Audit completeness** — setiap state transition (create / approve /
  reject) tercatat di `operation_audits`.
