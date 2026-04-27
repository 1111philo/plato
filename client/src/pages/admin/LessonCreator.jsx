import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import ReactMarkdown from 'react-markdown';

// Detect if a message contains a structured objectives summary from the
// lesson-creator agent. We look for the pattern the agent uses:
// an intro paragraph followed by lines starting with "- Can ".
function parseObjectivesFromMessage(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const objectiveLines = [];
  const introLines = [];
  const outroLines = [];
  let inObjectives = false;
  let doneWithObjectives = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!doneWithObjectives && (trimmed.startsWith('- Can ') || trimmed.match(/^\d+\.\s+Can /))) {
      inObjectives = true;
      // Strip leading "- " or "N. " to get the raw objective text
      objectiveLines.push(trimmed.replace(/^[-\d]+[.)\s]+/, '').trim());
    } else if (inObjectives && !doneWithObjectives && trimmed === '') {
      // blank line ends the objectives block
      doneWithObjectives = true;
    } else if (inObjectives && doneWithObjectives) {
      outroLines.push(line);
    } else if (!inObjectives) {
      introLines.push(line);
    } else {
      outroLines.push(line);
    }
  }

  if (objectiveLines.length < 1) return null;
  return { intro: introLines.join('\n').trim(), objectives: objectiveLines, outro: outroLines.join('\n').trim() };
}

function ObjectivesSummary({ parsed, onSelectObjective }) {
  return (
    <div>
      {parsed.intro && (
        <div className="mb-3 text-sm">
          <ReactMarkdown>{parsed.intro}</ReactMarkdown>
        </div>
      )}
      <ol className="list-none p-0 m-0 space-y-2">
        {parsed.objectives.map((obj, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelectObjective && onSelectObjective(obj, i + 1)}
              className="w-full text-left rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-colors px-3 py-2 text-sm cursor-pointer"
            >
              <span className="font-semibold text-primary mr-2">{i + 1}.</span>
              {obj}
            </button>
          </li>
        ))}
      </ol>
      {parsed.outro && (
        <div className="mt-3 text-sm">
          <ReactMarkdown>{parsed.outro}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function ChatMessage({ message, onSelectObjective }) {
  const isUser = message.role === 'user';
  const parsed = !isUser ? parseObjectivesFromMessage(message.content) : null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        {parsed ? (
          <ObjectivesSummary parsed={parsed} onSelectObjective={onSelectObjective} />
        ) : (
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children }) => <code className="bg-background/50 rounded px-1">{children}</code>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default function LessonCreator() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Create Lesson — plato';
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectObjective = (obj, num) => {
    setInput(`Let's refine objective ${num}: "${obj}" — `);
    inputRef.current?.focus();
  };

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    setError(null);

    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await adminApi('POST', '/v1/admin/lesson-creator', {
        messages: nextMessages,
        draft,
      });

      const assistantMsg = { role: 'assistant', content: response.message };
      setMessages(prev => [...prev, assistantMsg]);

      if (response.draft) {
        setDraft(response.draft);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setDraft(null);
    setInput('');
    setError(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await adminApi('POST', '/v1/admin/lessons', draft);
      navigate(`/plato/lessons/${saved.lessonId}`);
    } catch (err) {
      setError(err.message || 'Failed to save lesson.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Create a Lesson</h1>
          <p className="text-muted-foreground text-sm">
            Describe the lesson you want to create. The AI will help you build it.
          </p>
        </div>
        <div className="flex gap-2">
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset
            </Button>
          )}
          {draft && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Lesson'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 mb-4">
          {error}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              Start by describing the lesson topic, audience, or learning goal.
            </div>
          ) : (
            <div className="min-h-[300px] max-h-[500px] overflow-y-auto pr-1">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={msg}
                  onSelectObjective={handleSelectObjective}
                />
              ))}
              {loading && (
                <div className="flex justify-start mb-3">
                  <div className="bg-muted rounded-2xl px-4 py-2 text-sm text-muted-foreground">
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          ref={inputRef}
          className="flex-1 min-h-[60px] max-h-[160px] resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe what you want to create or refine…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <Button type="submit" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>

      {draft && (
        <div className="mt-4">
          <details className="rounded-lg border">
            <summary className="px-4 py-2 text-sm font-medium cursor-pointer select-none">
              Draft Lesson Preview
            </summary>
            <div className="px-4 pb-4">
              <pre className="text-xs overflow-auto whitespace-pre-wrap bg-muted rounded p-3 mt-2">
                {typeof draft === 'string' ? draft : JSON.stringify(draft, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
