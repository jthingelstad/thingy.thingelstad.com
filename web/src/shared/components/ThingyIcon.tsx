import { iconSvg } from '../thingy-icons.ts';

function ThingyIcon({ name }: { name: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
}

export { ThingyIcon };
