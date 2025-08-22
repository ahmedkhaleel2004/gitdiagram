export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const backendUrl = process.env.API_PROXY_URL || 'http://localhost:8000';
    const resp = await fetch(`${backendUrl}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Proxy streaming error:', error);
    return new Response(null, { status: 500 });
  }
}
