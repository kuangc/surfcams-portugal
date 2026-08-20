export default {
  async fetch() {
    return Response.json(
      { error: "Service unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  }
};
