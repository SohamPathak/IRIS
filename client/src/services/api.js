const BASE_URL = '/api/v1';
const API_KEY = 'iris-dev-key';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return handleResponse(res);
}

export async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function put(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function del(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers,
  });
  return handleResponse(res);
}
export async function patch(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}
