#!/bin/bash
set -e

echo "🧪 Fuxi E2E Tests"
echo "================"

case "${1:-run}" in
  run)
    echo "Running all E2E tests..."
    bunx playwright test
    ;;
  ui)
    echo "Opening Playwright UI..."
    bunx playwright test --ui
    ;;
  headed)
    echo "Running tests in headed mode..."
    bunx playwright test --headed
    ;;
  debug)
    echo "Running tests in debug mode..."
    bunx playwright test --debug
    ;;
  report)
    echo "Opening last test report..."
    bunx playwright show-report
    ;;
  *)
    echo "Usage: ./scripts/e2e.sh [command]"
    echo ""
    echo "Commands:"
    echo "  run     Run all tests (default)"
    echo "  ui      Open Playwright UI"
    echo "  headed  Run with browser visible"
    echo "  debug   Run in debug mode"
    echo "  report  Show last test report"
    ;;
esac
