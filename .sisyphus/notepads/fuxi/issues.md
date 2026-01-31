# Issues & Gotchas - Fuxi


## [2026-01-31] Task 1: Scaffolding

### Cold Start Performance
- **Issue**: Initial startup time is 5s, exceeds 2s target
- **Cause**: Tauri Rust compilation + dev server cold start
- **Resolution**: Defer to Task 17 (Performance optimization pass)
- **Impact**: Low - scaffold phase, infrastructure in place for optimization
