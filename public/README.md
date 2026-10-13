# MoneySync

Personal Finance, Bill Reminder, and Payment Tracking Integration System.

## Prototype Features
- Log in / sign up screen (accounts stored in this browser's localStorage — not a real backend)
- Per-account data: each account sees only its own transactions, bills, budget, and audit log
- User/dashboard interface
- Income and expense tracking
- Bill reminder and payment status
- Monthly budget tracking
- Mobile wallet CSV import simulation
- Financial reports
- Notifications
- Audit log
- LocalStorage data persistence
- Responsive UI

## Color Palette
- Deep Navy: #1D1D42
- Electric Purple: #4E2ECF
- Mint Green: #6FCF97
- White: #FFFFFF

## How to Run
1. Extract the ZIP file.
2. Open `index.html` in a browser.
3. No installation is required for this frontend prototype.

## CSV Format
The first row should be:
description,amount,type,category,method,date

Example:
Coffee,150,expense,Food,GCash,2026-09-24
Allowance,5000,income,Allowance,Bank,2026-09-24

## Important
This is a frontend prototype. The log in / sign up screen simulates authentication entirely in the browser (accounts and a simple password hash are kept in localStorage) — it is **not secure** and is not a substitute for real auth. For a final capstone, connect it to a backend such as Node.js + Express and MongoDB, then implement real authentication (e.g. hashed passwords with bcrypt + sessions/JWT), server-side audit logs, and a real/simulated external integration.
