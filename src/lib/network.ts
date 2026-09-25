/**
 * The network an address belongs to, for per-network limits. One IPv6
 * subscriber gets a whole /64 (home lines often a /56, cloud hosts a /48), so
 * limits keyed on the full address would let one person use billions of keys.
 * IPv4 and IPv4-mapped addresses stay whole.
 *
 * Pure (no Node or server imports): the presence worker bundles it too.
 */
export function networkOf(ip: string, prefix: 48 | 64 = 64): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(":")) return address;
  const [head, tail] = address.split("::", 2);
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
  // An embedded IPv4 literal is not a plain hextet: keep the address whole
  // rather than risk mangling it into a different prefix.
  if ([...headGroups, ...tailGroups].some((group) => group.includes(".")))
    return address;
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array.from(
            { length: Math.max(8 - headGroups.length - tailGroups.length, 0) },
            () => "0",
          ),
          ...tailGroups,
        ];
  if (groups.length < 8) return address;
  return `${groups
    .slice(0, prefix / 16)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/${prefix}`;
}
