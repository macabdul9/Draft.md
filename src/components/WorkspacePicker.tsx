import { useState, useEffect } from 'preact/hooks';
import {
  FolderOpen,
  HardDrive,
  Clock,
  FileText,
  FlaskConical,
  GraduationCap,
  BookOpen,
  LayoutTemplate,
  ArrowUpRight,
  GitFork,
} from 'lucide-preact';
import { Dialog } from './Dialog';
import { loadPreference, storePreference, type WorkspaceRecord } from '../storage/indexed-db';
import { supportsLocalFolders } from '../filesystem/native-filesystem';
import { todoTemplate } from '../editor/note-templates';
export interface Template {
  name: string;
  category: string;
  description: string;
  folders: string[];
  files: Record<string, string>;
}
export const templates: Template[] = [
  {
    name: 'Blank Workspace',
    category: 'Basic',
    description: 'A clean page. Make it your own.',
    folders: [],
    files: { 'README.md': '# My workspace\n\n' },
  },
  {
    name: 'To-do List',
    category: 'Basic',
    description: 'Add tasks, check them off, and keep track of what is done.',
    folders: [],
    files: { 'todo.md': todoTemplate },
  },
  {
    name: 'Project Notes',
    category: 'Basic',
    description: 'Plans, decisions, and progress for any project.',
    folders: ['notes', 'assets'],
    files: {
      'README.md':
        '# Project notes\n\n## Overview\n\n## Tasks\n- [ ] Write the project plan\n\n## Decisions\n\n',
      'notes/plan.md': '# Project plan\n\n## Goal\n\n## Milestones\n\n## Next steps\n',
    },
  },
  {
    name: 'Meeting Notes',
    category: 'Basic',
    description: 'Agendas, decisions, and action items.',
    folders: ['meetings'],
    files: {
      'README.md':
        '# Meeting notes\n\n## Agenda\n\n## Discussion\n\n## Decisions\n\n## Action items\n- [ ] \n',
    },
  },
  {
    name: 'Research Project',
    category: 'Research',
    description: 'Ideas, experiments, and everything in between.',
    folders: ['ideas', 'literature', 'meetings', 'experiments', 'figures'],
    files: {
      'README.md': '# Research project\n\n## Question\n\n## Next steps\n- [ ] \n',
      'references.bib': '',
    },
  },
  {
    name: 'Paper',
    category: 'Academic',
    description: 'A manuscript with room for the supporting work.',
    folders: ['figures', 'notes'],
    files: {
      'paper.md':
        '# Paper title\n\n## Abstract\n\n## Introduction\n\n## Method\n\n## Results\n\n## Discussion\n',
      'references.bib': '',
    },
  },
  {
    name: 'PhD Workspace',
    category: 'Academic',
    description: 'One place for a long research journey.',
    folders: ['ideas', 'papers', 'literature', 'experiments', 'meetings', 'talks', 'dissertation'],
    files: { 'README.md': '# PhD workspace\n\n## Research questions\n\n## This week\n' },
  },
  {
    name: 'Experiment Log',
    category: 'Experiments',
    description: 'Questions, setup, results, and what comes next.',
    folders: ['runs'],
    files: {
      'README.md': '# Experiment log\n\n',
      'experiment-template.md':
        '# Experiment: {{name}}\n\nDate: {{date}}\n\n## Question\nWhat are we testing?\n\n## Hypothesis\n\n## Setup\n### Model\n### Dataset\n### Parameters\n\n## Results\n## Observations\n## Conclusion\n## Next Steps\n',
    },
  },
  {
    name: 'Literature Review',
    category: 'Research',
    description: 'Read carefully. Connect the ideas.',
    folders: ['papers', 'synthesis'],
    files: {
      'README.md': '# Literature review\n\n## Scope\n\n## Open questions\n',
      'literature-template.md':
        '# {{paper-title}}\n\n## Citation\n## Problem\n## Main Idea\n## Method\n## Results\n## Strengths\n## Weaknesses\n## Questions\n## Connections\n',
    },
  },
  {
    name: 'Lab Notebook',
    category: 'Writing',
    description: 'A durable record of each day’s work.',
    folders: ['daily', 'meetings', 'assets'],
    files: {
      'README.md': '# Lab notebook\n\n## Current work\n',
      'meeting-template.md':
        '# Meeting — {{date}}\n\n## Attendees\n## Agenda\n## Notes\n## Decisions\n## Action Items\n- [ ]\n',
    },
  },
];
export function WorkspacePicker({
  recent,
  onOpenFolder,
  onRecent,
  onNew,
  onRepository,
  onClose,
}: {
  recent: WorkspaceRecord[];
  onOpenFolder: () => void;
  onRecent: (workspace: WorkspaceRecord) => void;
  onNew: () => void;
  onRepository: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState('Recent');
  return (
    <Dialog title="Open workspace" onClose={onClose} wide>
      <div class="picker-layout">
        <nav>
          {[
            { name: 'Recent', icon: Clock },
            { name: 'Local Folder', icon: FolderOpen },
            { name: 'Browser Storage', icon: HardDrive },
          ].map(({ name, icon: Icon }) => (
            <button class={section === name ? 'selected' : ''} onClick={() => setSection(name)}>
              <Icon size={16} />
              {name}
            </button>
          ))}
        </nav>
        <div class="picker-main">
          <h3>{section}</h3>
          {section === 'Local Folder' ? (
            <>
              <p>Choose a folder on your computer. Edits save to the ordinary files there.</p>
              {!supportsLocalFolders() && (
                <p class="compatibility">
                  Direct folder access isn’t available in this browser. Use browser-local storage,
                  or open Draft.md in Chrome/Edge for direct folder editing.
                </p>
              )}
              <button class="primary" disabled={!supportsLocalFolders()} onClick={onOpenFolder}>
                <FolderOpen size={16} />
                Open Folder
              </button>
            </>
          ) : (
            <>
              {section === 'Browser Storage' && (
                <p>
                  Stored inside this browser. Clearing site data can remove your workspace. Back up
                  regularly with Export ZIP.
                </p>
              )}
              {recent
                .filter((w) => section !== 'Browser Storage' || w.kind === 'browser')
                .map((workspace) => (
                  <button class="workspace-row" onClick={() => onRecent(workspace)}>
                    <span class="workspace-icon">
                      {workspace.kind === 'local' ? (
                        <FolderOpen size={20} />
                      ) : (
                        <HardDrive size={20} />
                      )}
                    </span>
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>
                        {workspace.kind === 'local' ? 'Local folder' : 'Browser workspace'} ·{' '}
                        {new Date(workspace.lastOpened).toLocaleDateString()}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              {!recent.length && (
                <div class="quiet-empty">Your recent workspaces will appear here.</div>
              )}
              <button class="subtle-link" onClick={onNew}>
                Create a new workspace
              </button>
            </>
          )}
        </div>
      </div>
      <footer>
        <button onClick={onRepository}>
          <GitFork size={16} /> Import Repository
        </button>
        <button onClick={onClose}>Cancel</button>
        <button class="primary" disabled={!supportsLocalFolders()} onClick={onOpenFolder}>
          Open Folder
        </button>
      </footer>
    </Dialog>
  );
}
export function TemplatePicker({
  onCreate,
  onClose,
}: {
  onCreate: (template: Template, name: string, kind: 'local' | 'browser') => void;
  onClose: () => void;
}) {
  const [recentTemplates, setRecentTemplates] = useState<string[]>([]);
  useEffect(() => {
    void loadPreference<string[]>('templates').then((value) => setRecentTemplates(value ?? []));
  }, []);
  const [category, setCategory] = useState('All Templates'),
    [selected, setSelected] = useState(templates[0]),
    [name, setName] = useState('Workspace'),
    [kind, setKind] = useState<'local' | 'browser'>(supportsLocalFolders() ? 'local' : 'browser');
  return (
    <Dialog title="New workspace" onClose={onClose} wide>
      <div class="picker-layout template-layout">
        <nav>
          {[
            'All Templates',
            'Recent',
            'Basic',
            'Research',
            'Academic',
            'Experiments',
            'Writing',
          ].map((c) => (
            <button class={c === category ? 'selected' : ''} onClick={() => setCategory(c)}>
              {c === 'All Templates' ? <LayoutTemplate size={15} /> : <span class="nav-dot" />}
              {c}
            </button>
          ))}
        </nav>
        <div class="picker-main">
          <h3>A place for your next idea</h3>
          <p>Start simple, or give your work a little structure.</p>
          <div class="template-grid">
            {templates
              .filter(
                (t) =>
                  category === 'All Templates' ||
                  (category === 'Recent'
                    ? recentTemplates.includes(t.name)
                    : t.category === category),
              )
              .map((template) => (
                <button
                  class={`template-card ${selected === template ? 'selected' : ''}`}
                  onClick={() => setSelected(template)}
                >
                  <div class="template-preview">
                    {template.category === 'Experiments' ? (
                      <FlaskConical size={27} />
                    ) : template.category === 'Academic' ? (
                      <GraduationCap size={27} />
                    ) : template.category === 'Research' ? (
                      <BookOpen size={27} />
                    ) : (
                      <FileText size={27} />
                    )}
                    <span />
                    <span />
                    <span />
                  </div>
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </button>
              ))}
          </div>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void storePreference(
            'templates',
            [selected.name, ...recentTemplates.filter((name) => name !== selected.name)].slice(
              0,
              7,
            ),
          );
          onCreate(selected, name, kind);
        }}
      >
        <div class="template-options">
          <label>
            Workspace name
            <input value={name} onInput={(event) => setName(event.currentTarget.value)} required />
          </label>
          <label>
            Storage
            <select
              value={kind}
              onChange={(event) => setKind(event.currentTarget.value as 'local' | 'browser')}
            >
              <option value="local" disabled={!supportsLocalFolders()}>
                Local Folder — Recommended
              </option>
              <option value="browser">Browser Workspace</option>
            </select>
          </label>
          <small>
            {kind === 'local'
              ? 'You’ll choose a parent folder. A new folder will be created there.'
              : 'Stored in this browser, not in a visible folder. Export ZIP for backups.'}
          </small>
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button class="primary" type="submit">
            Create workspace
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
