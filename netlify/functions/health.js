export default async (req, context) => {
  return new Response(JSON.stringify({ status: "ok", provider: "netlify" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
};
