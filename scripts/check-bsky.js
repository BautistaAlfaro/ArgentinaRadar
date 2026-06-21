const { BskyAgent } = require('@atproto/api');
const agent = new BskyAgent({ service: 'https://bsky.social' });

(async () => {
  await agent.login({ identifier: 'sitearsdevs.bsky.social', password: 'Mb300$1234' });
  const feed = await agent.getAuthorFeed({ actor: 'sitearsdevs.bsky.social', limit: 5 });
  for (const item of feed.data.feed) {
    const post = item.post;
    const embed = post.record.embed;
    const hasImage = embed && embed.$type === 'app.bsky.embed.images';
    const text = (post.record.text || '').substring(0, 70);
    console.log(hasImage ? '🖼️ ' : '📝 ', text);
  }
})();
