type UploadedVideoPlayerProps = {
  src: string | undefined;
  title: string;
};

export default function UploadedVideoPlayer({ src, title }: UploadedVideoPlayerProps) {
  return (
    <div className="relative left-1/2 h-screen w-screen -translate-x-1/2 overflow-hidden bg-muted sm:static sm:aspect-video sm:h-auto sm:w-full sm:translate-x-0 sm:rounded-md">
      <video
        src={src}
        aria-label={title}
        controls
        playsInline
        preload="metadata"
        className="block h-full w-full object-cover sm:object-contain"
      />
    </div>
  );
}