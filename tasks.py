from invoke import task

@task
def hello(c, name='yattom'):
    """Say hello to someone"""
    print(f"Hello, {name}!")
