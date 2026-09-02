import { iconSvg } from '../../shared/thingy-icons.ts';

export function Icon({ name }: { name: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
}
