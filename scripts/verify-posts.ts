import axios from 'axios';
import { env } from '../src/config/env.js';

const client = axios.create({
  baseURL: 'https://api.buffer.com',
  headers: { Authorization: `Bearer ${env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
});

const ids = process.argv.slice(2);

for (const id of ids) {
  const res = await client.post('/', {
    query: `query GetPost($input: PostInput!) { post(input: $input) { id dueAt status } }`,
    variables: { input: { id } },
  });
  console.log(id, JSON.stringify(res.data));
}
