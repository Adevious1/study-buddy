import { useEffect, useState } from 'react';

export function useResource<T>(loader: () => Promise<T>): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    let live = true;
    loader().then((d) => { if (live) setData(d); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}
