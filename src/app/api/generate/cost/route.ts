import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const backendUrl = process.env.API_PROXY_URL || 'http://localhost:8000';
    const resp = await fetch(`${backendUrl}/generate/cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (error) {
    console.error('Proxy cost error:', error);
    return NextResponse.json({ error: 'Proxy error' }, { status: 500 });
  }
}
