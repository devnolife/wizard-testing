export function GET() {
  // Intentional failing API: always returns a 500 with an unhelpful body.
  throw new Error("Intentional server error in /api/broken");
}
