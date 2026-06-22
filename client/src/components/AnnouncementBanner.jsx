import { Button } from '@/components/ui/button';

export default function AnnouncementBanner() {
  return (
    <div className="w-full bg-purple-700 border-b border-purple-600" role="banner">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-center gap-4 flex-wrap">
        <p className="text-white font-medium text-sm sm:text-base">
          Meet the AI Leaders Finalists
        </p>
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="bg-white text-purple-700 hover:bg-purple-50"
        >
          <a
            href="https://aileaderswp.blog/"
            target="_blank"
            rel="noopener noreferrer"
          >
            View Portfolios
          </a>
        </Button>
      </div>
    </div>
  );
}
