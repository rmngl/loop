-- Company-wide monthly spend ceiling (Paperclip-style org budget). NULL = no cap.
ALTER TABLE companies ADD COLUMN monthly_budget_usd REAL;