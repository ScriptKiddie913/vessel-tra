import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>NAVTRACK — Global Ship Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <iframe
        src="/map.html"
        title="NAVTRACK"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </>
  );
}
